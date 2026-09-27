import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { parsearDotenv, type Repositorio, type Servicio } from "@orq/shared";
import type { R2Storage } from "@orq/tools";
import { detectarProduccion } from "./qa-movil.js";

/**
 * Cloudflare R2 para **verificar**, no para escribir: que la foto que la app
 * dice haber subido esté de verdad en el bucket, con el tamaño y el tipo que
 * corresponde. Es `inspeccionar_medio` aplicado al almacenamiento: un agente
 * que valida una subida mirando sólo la UI o la respuesta del backend repite
 * lo que le dijeron; el bucket es la fuente de verdad.
 *
 * Tres decisiones:
 * - **Sin SDK.** R2 habla S3, y S3 es HTTP firmado con SigV4: se firma con
 *   `crypto` de Node. Es la misma regla de ffmpeg, Kokoro y Chrome —usar lo
 *   que hay— y evita traer un SDK de 3 MB para dos verbos de lectura.
 * - **Las credenciales son las del servicio**, leídas de sus `.env` en el
 *   momento, como hace la vista previa. No se copian a la base ni al prompt:
 *   el agente nombra una clave y recibe metadatos, nunca una llave.
 * - **Sólo staging.** Si el entorno del servicio tiene un marcador de
 *   producción del repo, no se consulta: el bucket de producción tiene fotos
 *   de clientes reales.
 */

export interface CredencialesR2 {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** Las variables que usa el backend de INSPIA; son las que propone la documentación de R2. */
export function credencialesR2(env: Record<string, string>): { ok: true; cred: CredencialesR2 } | { ok: false; faltan: string[] } {
  const v = (k: string) => env[k]?.trim() ?? "";
  const endpoint = v("R2_ENDPOINT") || (v("R2_ACCOUNT_ID") ? `https://${v("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com` : "");
  const faltan = [
    ...(endpoint ? [] : ["R2_ENDPOINT (o R2_ACCOUNT_ID)"]),
    ...["R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"].filter((k) => !v(k)),
  ];
  if (faltan.length) return { ok: false, faltan };
  return {
    ok: true,
    cred: {
      endpoint: endpoint.replace(/\/+$/, ""),
      bucket: v("R2_BUCKET"),
      region: v("R2_REGION") || "auto",
      accessKeyId: v("R2_ACCESS_KEY_ID"),
      secretAccessKey: v("R2_SECRET_ACCESS_KEY"),
    },
  };
}

const sha256 = (dato: string | Buffer) => createHash("sha256").update(dato).digest("hex");
const hmac = (clave: string | Buffer, dato: string) => createHmac("sha256", clave).update(dato).digest();
/** RFC 3986 como lo pide SigV4: todo menos lo no reservado; `/` se conserva en la ruta. */
const codificar = (texto: string, conservarBarra: boolean) =>
  encodeURIComponent(texto)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%2F/g, conservarBarra ? "/" : "%2F");

/**
 * Firma SigV4 de un pedido S3 sin cuerpo. Pura: recibe la fecha, así se fija
 * con el vector de ejemplo de la documentación de AWS.
 */
export function firmarS3(pedido: {
  metodo: "GET" | "HEAD";
  host: string;
  ruta: string;
  query: Record<string, string>;
  cabeceras?: Record<string, string>;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  fecha: Date;
}): Record<string, string> {
  const amzDate = pedido.fecha.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const dia = amzDate.slice(0, 8);
  const hashVacio = sha256("");
  const cabeceras: Record<string, string> = {
    host: pedido.host,
    "x-amz-content-sha256": hashVacio,
    "x-amz-date": amzDate,
    ...Object.fromEntries(Object.entries(pedido.cabeceras ?? {}).map(([k, v]) => [k.toLowerCase(), v.trim()])),
  };
  const nombres = Object.keys(cabeceras).sort();
  const query = Object.keys(pedido.query)
    .sort()
    .map((k) => `${codificar(k, false)}=${codificar(pedido.query[k]!, false)}`)
    .join("&");
  const canonico = [
    pedido.metodo,
    codificar(pedido.ruta, true),
    query,
    nombres.map((n) => `${n}:${cabeceras[n]}\n`).join(""),
    nombres.join(";"),
    hashVacio,
  ].join("\n");
  const alcance = `${dia}/${pedido.region}/s3/aws4_request`;
  const aFirmar = ["AWS4-HMAC-SHA256", amzDate, alcance, sha256(canonico)].join("\n");
  const clave = hmac(hmac(hmac(hmac(`AWS4${pedido.secretAccessKey}`, dia), pedido.region), "s3"), "aws4_request");
  const firma = createHmac("sha256", clave).update(aFirmar).digest("hex");
  const { host: _host, ...resto } = cabeceras;
  return {
    ...resto,
    authorization: `AWS4-HMAC-SHA256 Credential=${pedido.accessKeyId}/${alcance}, SignedHeaders=${nombres.join(";")}, Signature=${firma}`,
  };
}

/** Un endpoint que acepta la conexión y se calla cuelga el turno: todo pedido lleva corte. */
const CORTE_MS = 20_000;
/** Lo más grande que se descarga para mirar: una foto de teléfono, holgada. */
const MAX_DESCARGA = 25 * 1024 * 1024;

async function pedirR2(
  cred: CredencialesR2,
  metodo: "GET" | "HEAD",
  clave: string | null,
  query: Record<string, string> = {},
  cabeceras: Record<string, string> = {},
): Promise<Response> {
  const base = new URL(cred.endpoint);
  // Estilo ruta (/<bucket>/<clave>): R2 no requiere el subdominio por bucket.
  const ruta = `${base.pathname.replace(/\/$/, "")}/${cred.bucket}${clave != null ? `/${clave}` : ""}`;
  const firmadas = firmarS3({ metodo, host: base.host, ruta, query, cabeceras, region: cred.region, accessKeyId: cred.accessKeyId, secretAccessKey: cred.secretAccessKey, fecha: new Date() });
  const qs = Object.keys(query)
    .sort()
    .map((k) => `${codificar(k, false)}=${codificar(query[k]!, false)}`)
    .join("&");
  const url = `${base.protocol}//${base.host}${codificar(ruta, true)}${qs ? `?${qs}` : ""}`;
  return fetch(url, { method: metodo, headers: firmadas, signal: AbortSignal.timeout(CORTE_MS) });
}

const desXml = (t: string) =>
  t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const etiqueta = (xml: string, nombre: string) => {
  const m = new RegExp(`<${nombre}>([\\s\\S]*?)</${nombre}>`).exec(xml);
  return m ? desXml(m[1]!) : null;
};

/** La respuesta de ListObjectsV2, aplanada. */
export function parsearListado(xml: string): {
  objetos: Array<{ clave: string; tamano: number; modificado: string }>;
  carpetas: string[];
  siguiente: string | null;
} {
  const objetos = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map((m) => ({
    clave: etiqueta(m[1]!, "Key") ?? "",
    tamano: Number(etiqueta(m[1]!, "Size") ?? 0),
    modificado: etiqueta(m[1]!, "LastModified") ?? "",
  }));
  const carpetas = [...xml.matchAll(/<CommonPrefixes>([\s\S]*?)<\/CommonPrefixes>/g)].map((m) => etiqueta(m[1]!, "Prefix") ?? "");
  const truncado = etiqueta(xml, "IsTruncated") === "true";
  return { objetos, carpetas, siguiente: truncado ? etiqueta(xml, "NextContinuationToken") : null };
}

/** Qué es de verdad un archivo, por sus primeros bytes: el `content-type` lo declara quien subió. */
export function detectarContenido(b: Buffer): string | null {
  const hex = b.subarray(0, 12).toString("hex");
  if (hex.startsWith("ffd8ff")) return "image/jpeg";
  if (hex.startsWith("89504e470d0a1a0a")) return "image/png";
  if (b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (b.subarray(4, 8).toString("latin1") === "ftyp") {
    const marca = b.subarray(8, 12).toString("latin1");
    if (/^(heic|heix|mif1|msf1|hevc)$/.test(marca)) return "image/heic";
    return "video/mp4";
  }
  if (b.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (b.subarray(0, 6).toString("latin1") === "GIF87a" || b.subarray(0, 6).toString("latin1") === "GIF89a") return "image/gif";
  if (hex.startsWith("504b0304")) return "application/zip";
  return null;
}

const tamanoLegible = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(2)} MB`;

export interface DepsR2 {
  /** Los repos del proyecto: el bucket sale del servicio que declara `R2_*`. */
  repos(): Repositorio[];
  /** Guarda una descarga en la salida del proyecto y devuelve su ruta. */
  guardarEnSalida(nombre: string, carpeta: string, bytes: Buffer): Promise<string>;
}

type Objetivo = { cred: CredencialesR2; servicio: Servicio; repo: Repositorio };

export function crearR2Storage(deps: DepsR2): R2Storage {
  const entornoDe = async (servicio: Servicio): Promise<Record<string, string>> => {
    const variables: Record<string, string> = {};
    for (const archivo of servicio.archivosEntorno) {
      try {
        Object.assign(variables, parsearDotenv(await readFile(archivo, "utf8")));
      } catch {
        /* un .env que no está no aporta variables */
      }
    }
    return { ...variables, ...servicio.entorno };
  };

  const objetivo = async (repoArg: string | undefined): Promise<{ ok: true; o: Objetivo } | { ok: false; motivo: string }> => {
    const todos = deps.repos();
    const repos = repoArg
      ? todos.filter((r) => r.id === repoArg || r.slug === repoArg || r.nombre.toLowerCase() === repoArg.toLowerCase())
      : todos;
    if (repoArg && repos.length === 0) return { ok: false, motivo: `No hay un repo "${repoArg}".` };
    const incompletos: string[] = [];
    for (const repo of repos) {
      // La API primero: es la que sube a R2.
      const servicios = [...repo.servicios].sort((a, b) => Number(b.tipo === "api") - Number(a.tipo === "api"));
      for (const servicio of servicios) {
        const env = await entornoDe(servicio);
        if (!env.R2_BUCKET && !env.R2_ENDPOINT && !env.R2_ACCOUNT_ID) continue;
        const c = credencialesR2(env);
        if (!c.ok) {
          incompletos.push(`${repo.nombre}/${servicio.nombre}: faltan ${c.faltan.join(", ")}`);
          continue;
        }
        const marcadores = repo.servicios.flatMap((s) => s.marcadoresProduccion ?? []);
        const prod = detectarProduccion(env, marcadores);
        if (prod.produccion) {
          return {
            ok: false,
            motivo: `El entorno de ${servicio.nombre} apunta a producción (${prod.variables.join(", ")}): el bucket de producción no se consulta. Pasalo a staging.`,
          };
        }
        return { ok: true, o: { cred: c.cred, servicio, repo } };
      }
    }
    return {
      ok: false,
      motivo: incompletos.length
        ? `El servicio declara R2 pero le faltan variables — ${incompletos.join("; ")}. Se cargan en su .env (pestaña Código → servicio).`
        : "Ningún servicio del proyecto tiene credenciales de R2 en su entorno (R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY y R2_ENDPOINT o R2_ACCOUNT_ID). Las carga una persona en el .env del backend.",
    };
  };

  /** Un error de S3 trae su código en XML: eso es lo que sirve para corregir, no el 403 a secas. */
  const explicar = async (res: Response) => {
    const cuerpo = await res.text().catch(() => "");
    const codigo = etiqueta(cuerpo, "Code");
    const mensaje = etiqueta(cuerpo, "Message");
    return `R2 contestó ${res.status}${codigo ? ` ${codigo}` : ""}${mensaje ? `: ${mensaje}` : ""}.`;
  };

  return {
    async listar(repoArg, pedido) {
      const r = await objetivo(repoArg);
      if (!r.ok) return r;
      const query: Record<string, string> = { "list-type": "2", "max-keys": String(pedido.limite) };
      if (pedido.prefijo) query.prefix = pedido.prefijo;
      if (pedido.carpetas) query.delimiter = "/";
      if (pedido.desde) query["continuation-token"] = pedido.desde;
      try {
        const res = await pedirR2(r.o.cred, "GET", null, query);
        if (!res.ok) return { ok: false, motivo: await explicar(res) };
        const l = parsearListado(await res.text());
        const total = l.objetos.reduce((s, o) => s + o.tamano, 0);
        const lineas = [
          `Bucket ${r.o.cred.bucket} (de ${r.o.servicio.nombre}), prefijo «${pedido.prefijo || ""}»: ${l.objetos.length} objeto(s), ${tamanoLegible(total)}${l.carpetas.length ? `, ${l.carpetas.length} carpeta(s)` : ""}.`,
          ...l.carpetas.map((c) => `📁 ${c}`),
          ...l.objetos.map((o) => `${o.clave}  ${tamanoLegible(o.tamano)}  ${o.modificado}${o.tamano === 0 ? "  ⚠️ VACÍO" : ""}`),
          ...(l.siguiente ? [`Hay más: repetí con desde="${l.siguiente}".`] : []),
        ];
        return { ok: true, texto: lineas.join("\n") };
      } catch (error) {
        return { ok: false, motivo: `No se pudo hablar con R2: ${error instanceof Error ? error.message : String(error)}` };
      }
    },

    async objetos(repoArg, claves, opciones) {
      const r = await objetivo(repoArg);
      if (!r.ok) return r;
      const informe: string[] = [`Bucket ${r.o.cred.bucket} (de ${r.o.servicio.nombre}):`];
      let descargas = 0;
      for (const clave of claves) {
        try {
          const cabeza = await pedirR2(r.o.cred, "HEAD", clave);
          if (cabeza.status === 404) {
            informe.push(`❌ ${clave}: NO EXISTE en el bucket.`);
            continue;
          }
          if (!cabeza.ok) {
            informe.push(`❌ ${clave}: ${await explicar(cabeza)}`);
            continue;
          }
          const tamano = Number(cabeza.headers.get("content-length") ?? 0);
          const declarado = cabeza.headers.get("content-type") ?? "(sin content-type)";
          const meta = [...cabeza.headers.entries()]
            .filter(([k]) => k.startsWith("x-amz-meta-"))
            .map(([k, v]) => `${k.slice(11)}=${v.slice(0, 120)}`);
          const avisos: string[] = [];
          let real: string | null = null;
          if (tamano === 0) avisos.push("está VACÍO (0 bytes)");
          else {
            const inicio = await pedirR2(r.o.cred, "GET", clave, {}, { range: "bytes=0-31" });
            if (inicio.ok) {
              real = detectarContenido(Buffer.from(await inicio.arrayBuffer()));
              const base = declarado.split(";")[0]!.trim().toLowerCase();
              // El texto no tiene firma en sus bytes: que no se reconozca no dice nada.
              const esTexto = /^text\/|\/(json|xml|csv)$/.test(base);
              if (!real && !esTexto) avisos.push("no se reconoce el formato por sus primeros bytes");
              else if (real !== base && !(real === "video/mp4" && base.startsWith("video/"))) {
                avisos.push(`declara ${base} pero el contenido es ${real}`);
              }
            }
          }
          const linea = [
            `${avisos.length ? "⚠️" : "✅"} ${clave}: ${tamanoLegible(tamano)}, ${declarado}${real ? ` (contenido: ${real})` : ""}, subido ${cabeza.headers.get("last-modified") ?? "?"}`,
            ...(meta.length ? [`   metadatos: ${meta.join(", ")}`] : []),
            ...avisos.map((a) => `   ⚠️ ${a}`),
          ];
          if (opciones.guardar && tamano > 0) {
            if (descargas >= 5) linea.push("   (no se descargó: hasta 5 por llamada)");
            else if (tamano > MAX_DESCARGA) linea.push(`   (no se descargó: pesa más de ${tamanoLegible(MAX_DESCARGA)})`);
            else {
              const res = await pedirR2(r.o.cred, "GET", clave);
              if (res.ok) {
                descargas++;
                const nombre = basename(clave).replace(/[^\w.\-]/g, "_") || "objeto";
                linea.push(`   guardado en ${await deps.guardarEnSalida(nombre, "revision/r2", Buffer.from(await res.arrayBuffer()))} — abrilo con tus herramientas de lectura para mirarlo.`);
              } else linea.push(`   no se pudo descargar: ${await explicar(res)}`);
            }
          }
          informe.push(...linea);
        } catch (error) {
          informe.push(`❌ ${clave}: no se pudo hablar con R2 (${error instanceof Error ? error.message : String(error)}).`);
        }
      }
      return { ok: true, texto: informe.join("\n") };
    },
  };
}
