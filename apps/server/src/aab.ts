import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { parsearDotenv, type Repositorio, type Servicio } from "@orq/shared";
import { entornoDeComando } from "@orq/tools";
import { correrEnVivo, correrReal, detectarJava, type Correr } from "./dispositivos.js";
import { git } from "./git.js";
import { argvDeInstalacionLimpia, copiarModulos } from "./servicios.js";

/**
 * El build de producción de una app de Expo —el AAB para Play o el APK para
 * instalar directo (`FormatoAndroid`)—, armado por la persona desde el IDE.
 *
 * Es el procedimiento que un proyecto ya tiene escrito (en INSPIA,
 * `mobile/BUILD-AAB.md`) hecho de una forma que no se puede hacer mal por
 * cansancio. Cuatro decisiones:
 *
 * - **Se construye una copia exacta, no la carpeta viva.** `git archive` del
 *   commit (o de una instantánea, si la persona elige incluir lo que no
 *   commiteó) a una carpeta temporal. Así el AAB es reproducible —se sabe de
 *   qué código salió—, un agente que edita en la sesión no se cuela a mitad de
 *   la compilación, el Metro de la vista previa no se entera, y no existe la
 *   trampa del bundle viejo que Gradle da por "UP-TO-DATE": cada build arranca
 *   de cero.
 * - **El entorno de producción entra sólo al proceso del build.** Se lee el
 *   `.env.prod` de la carpeta de la persona y se inyecta; no se copia a ningún
 *   lado, no se guarda en la base y no pasa por la redirección de URLs de la
 *   vista previa (un `127.0.0.1` horneado en un AAB de producción sería una app
 *   que no anda en ningún teléfono). Expo no pisa variables que ya están en el
 *   entorno, así que ningún `.env` gana por accidente.
 * - **La firma no pasa por el orquestador.** Gradle lee las credenciales de
 *   `~/.gradle/gradle.properties` de la persona; si el proyecto trae un script
 *   que reinyecta la firma después del prebuild (`scripts/apply-signing.mjs`),
 *   se corre. Lo que sí se hace es **verificar** el resultado: un AAB firmado
 *   con la clave de depuración se rechaza acá y no en Play.
 * - **Se verifica lo que Play va a mirar** antes de entregar: el certificado
 *   (y que sea el mismo que el AAB anterior), el `versionCode` (mayor que el
 *   anterior), los permisos (ninguno de `blockedPermissions`) y que el bundle
 *   apunte a producción —cada valor de `.env.prod` adentro, ninguno de los de
 *   desarrollo, ninguna URL local—.
 */

const CORTE_MS = 45 * 60_000;
const MAX_LINEAS = 3_000;
const ARCHIVOS_PRODUCCION = [".env.prod", ".env.production", ".env.produccion"];
const SCRIPTS_DE_FIRMA = ["scripts/apply-signing.mjs", "scripts/apply-signing.js"];

// --- Funciones puras ------------------------------------------------------------

/** `1.0.18` → `1.0.19`. Si no es semver, se devuelve igual y la persona lo escribe. */
export function siguienteVersion(version: string): string {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  return m ? `${m[1]}.${m[2]}.${Number(m[3]) + 1}` : version;
}

/**
 * Sube `expo.version` y `expo.android.versionCode` sin reformatear el archivo:
 * un `app.json` reescrito entero es un diff de cien líneas para cambiar dos.
 */
export function subirVersionEnAppJson(texto: string, version: string, versionCode: number): string {
  const actual = JSON.parse(texto) as { expo?: { version?: string; android?: { versionCode?: number } } };
  const versionActual = actual.expo?.version;
  const codeActual = actual.expo?.android?.versionCode;
  let nuevo = texto;
  if (versionActual != null) {
    nuevo = nuevo.replace(new RegExp(`("version"\\s*:\\s*)"${escapar(versionActual)}"`), `$1"${version}"`);
  }
  if (codeActual != null) {
    nuevo = nuevo.replace(new RegExp(`("versionCode"\\s*:\\s*)${codeActual}\\b`), `$1${versionCode}`);
  }
  const verificado = JSON.parse(nuevo) as typeof actual;
  if (verificado.expo?.version === version && verificado.expo?.android?.versionCode === versionCode) return nuevo;
  // El reemplazo puntual no alcanzó (otra clave "version" antes, un campo que no estaba): se reescribe.
  const obj = JSON.parse(texto) as { expo: { version?: string; android?: { versionCode?: number } } };
  obj.expo.version = version;
  obj.expo.android = { ...(obj.expo.android ?? {}), versionCode };
  return `${JSON.stringify(obj, null, 2)}\n`;
}

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Un lector mínimo del formato de cable de protobuf: lo justo para el manifiesto de un AAB. */
function camposProto(b: Buffer): Array<{ n: number; valor: Buffer | number }> {
  const campos: Array<{ n: number; valor: Buffer | number }> = [];
  let i = 0;
  const varint = (): number => {
    let r = 0;
    let factor = 1;
    for (;;) {
      const byte = b[i++];
      if (byte === undefined) throw new Error("Manifiesto truncado.");
      r += (byte & 0x7f) * factor;
      if ((byte & 0x80) === 0) return r;
      factor *= 128;
    }
  };
  while (i < b.length) {
    const clave = varint();
    const n = Math.floor(clave / 8);
    const tipo = clave & 7;
    if (tipo === 0) campos.push({ n, valor: varint() });
    else if (tipo === 2) {
      const largo = varint();
      campos.push({ n, valor: b.subarray(i, i + largo) });
      i += largo;
    } else if (tipo === 5) i += 4;
    else if (tipo === 1) i += 8;
    else throw new Error(`Tipo de campo protobuf desconocido: ${tipo}.`);
  }
  return campos;
}

export interface ManifiestoAab {
  paquete: string | null;
  versionCode: number | null;
  versionName: string | null;
  permisos: string[];
}

/**
 * `base/manifest/AndroidManifest.xml` de un AAB está en el protobuf de aapt2
 * (`XmlNode`), que `aapt2 dump` no lee dentro de un bundle y `bundletool` no
 * suele estar instalado. XmlNode{1: element}; XmlElement{3: name, 4: attribute,
 * 5: child}; XmlAttribute{2: name, 3: value}.
 */
export function parsearManifiestoProto(buf: Buffer): ManifiestoAab {
  const texto = (v: Buffer | number | undefined) => (Buffer.isBuffer(v) ? v.toString("utf8") : "");
  const elemento = (nodo: Buffer) => {
    const e = camposProto(nodo).find((c) => c.n === 1)?.valor;
    return Buffer.isBuffer(e) ? e : null;
  };
  const describir = (el: Buffer) => {
    const campos = camposProto(el);
    const nombre = texto(campos.find((c) => c.n === 3)?.valor);
    const atributos: Record<string, string> = {};
    for (const c of campos.filter((x) => x.n === 4 && Buffer.isBuffer(x.valor))) {
      const a = camposProto(c.valor as Buffer);
      atributos[texto(a.find((x) => x.n === 2)?.valor)] = texto(a.find((x) => x.n === 3)?.valor);
    }
    const hijos = campos
      .filter((x) => x.n === 5 && Buffer.isBuffer(x.valor))
      .map((x) => elemento(x.valor as Buffer))
      .filter((x): x is Buffer => x != null);
    return { nombre, atributos, hijos };
  };
  const raiz = elemento(buf);
  if (!raiz) throw new Error("El manifiesto del AAB no tiene raíz.");
  const manifiesto = describir(raiz);
  const permisos = manifiesto.hijos
    .map(describir)
    .filter((h) => h.nombre === "uses-permission" || h.nombre === "uses-permission-sdk-23")
    .map((h) => h.atributos.name ?? "")
    .filter(Boolean);
  const code = Number(manifiesto.atributos.versionCode);
  return {
    paquete: manifiesto.atributos.package ?? null,
    versionCode: Number.isFinite(code) && manifiesto.atributos.versionCode ? code : null,
    versionName: manifiesto.atributos.versionName ?? null,
    permisos: [...new Set(permisos)].sort(),
  };
}

/** `keytool -printcert` en inglés (se fuerza con `-J-Duser.language=en`). */
export function parsearCertificado(salida: string): { propietario: string; sha256: string } | null {
  const propietario = /Owner:\s*(.+)/.exec(salida)?.[1]?.trim();
  const sha256 = /SHA256:\s*([0-9A-F:]{95})/i.exec(salida)?.[1]?.toUpperCase();
  return propietario && sha256 ? { propietario, sha256 } : null;
}

/**
 * Qué se entrega: el AAB es lo que se sube a Play; el APK es lo que se instala
 * directo en un teléfono (distribución por fuera de la tienda, una prueba en el
 * equipo de un cliente). Salen del mismo código, del mismo `.env.prod` y con la
 * misma firma, y se verifican igual.
 */
export type FormatoAndroid = "aab" | "apk";

/**
 * `aapt2 dump badging` de un APK. El manifiesto de un APK es XML binario
 * (AXML), no el protobuf de un AAB, y aapt2 sí lo lee.
 */
export function parsearBadging(salida: string): ManifiestoAab {
  const paquete = /^package: name='([^']+)'/m.exec(salida);
  const code = /^package:.*\bversionCode='(\d+)'/m.exec(salida)?.[1];
  const permisos = [...salida.matchAll(/^uses-permission(?:-sdk-23)?: name='([^']+)'/gm)].map((m) => m[1]!);
  return {
    paquete: paquete?.[1] ?? null,
    versionCode: code ? Number(code) : null,
    versionName: /^package:.*\bversionName='([^']*)'/m.exec(salida)?.[1] ?? null,
    permisos: [...new Set(permisos)].sort(),
  };
}

/**
 * `apksigner verify --print-certs`. Un APK moderno va firmado con el esquema
 * v2/v3, que vive fuera del zip: `keytool -jarfile` no lo ve y contesta "no
 * firmado" sobre un APK que está bien firmado.
 */
export function parsearApksigner(salida: string): { propietario: string; sha256: string } | null {
  const propietario = /certificate DN:\s*(.+)/.exec(salida)?.[1]?.trim();
  const sha256 = /certificate SHA-256 digest:\s*([0-9a-f]{64})/i.exec(salida)?.[1];
  return propietario && sha256 ? { propietario, sha256: sha256.toUpperCase().match(/../g)!.join(":") } : null;
}

export interface Verificacion {
  nombre: string;
  /** `true` pasa, `false` bloquea la entrega, `null` es un aviso para mirar. */
  ok: boolean | null;
  detalle: string;
}

/**
 * Que el bundle apunte adonde dice `.env.prod`: cada `EXPO_PUBLIC_*` de
 * producción adentro, ningún valor de desarrollo que difiera y ninguna URL de
 * la vista previa del orquestador. Nunca se escriben los valores: sólo los
 * nombres.
 */
export function verificarBundle(bundle: Buffer, produccion: Record<string, string>, desarrollo: Record<string, string>): Verificacion[] {
  const publicas = Object.entries(produccion).filter(([k, v]) => k.startsWith("EXPO_PUBLIC_") && v.trim());
  const faltan = publicas.filter(([, v]) => !bundle.includes(Buffer.from(v))).map(([k]) => k);
  const colados = Object.entries(desarrollo)
    .filter(([k, v]) => k.startsWith("EXPO_PUBLIC_") && v.trim().length >= 8 && produccion[k] !== v)
    .filter(([, v]) => bundle.includes(Buffer.from(v)))
    .map(([k]) => k);
  const locales = ["http://127.0.0.1:43", "http://127.0.0.1:44", "http://localhost:3001", "http://localhost:5173"].filter((u) =>
    bundle.includes(Buffer.from(u)),
  );
  return [
    {
      nombre: "Variables de producción adentro del bundle",
      ok: publicas.length > 0 && faltan.length === 0,
      detalle:
        publicas.length === 0
          ? "El .env de producción no tiene variables EXPO_PUBLIC_*."
          : faltan.length === 0
            ? `Las ${publicas.length} (${publicas.map(([k]) => k).join(", ")}) están con su valor de producción.`
            : `No aparece el valor de producción de: ${faltan.join(", ")}.`,
    },
    {
      nombre: "Nada de desarrollo ni de staging",
      ok: colados.length === 0,
      detalle: colados.length === 0 ? "Ningún valor del .env de desarrollo que difiera de producción quedó adentro." : `Quedaron valores de desarrollo de: ${colados.join(", ")}.`,
    },
    {
      nombre: "Ninguna URL de la vista previa",
      ok: locales.length === 0,
      detalle: locales.length === 0 ? "No hay URLs del orquestador ni de localhost de desarrollo." : `El bundle tiene ${locales.join(", ")}: no anda en ningún teléfono.`,
    },
  ];
}

// --- El trabajo ------------------------------------------------------------------

export interface PlanDeAab {
  paquete: string;
  version: string;
  versionCode: number;
  sugerida: { version: string; versionCode: number };
  commit: { sha: string; asunto: string; rama: string };
  cambiosSinCommitear: number;
  entorno: { archivo: string; variables: string[] } | null;
  firma: string | null;
  anterior: { archivo: string; version: string | null; versionCode: number | null } | null;
  historial: ResultadoAab[];
  avisos: string[];
}

export interface ResultadoAab {
  /** Los builds de antes del APK no lo traen: son AAB. */
  formato?: FormatoAndroid;
  archivo: string;
  url: string;
  bytes: number;
  sha256: string;
  version: string;
  versionCode: number;
  commit: string;
  incluyeCambios: boolean;
  certificado: { propietario: string; sha256: string } | null;
  permisos: string[];
  verificaciones: Verificacion[];
  fecha: number;
}

export interface TrabajoAab {
  id: string;
  estado: "construyendo" | "listo" | "fallo";
  paso: string;
  lineas: string[];
  desde: number;
  resultado: ResultadoAab | null;
}

export interface ContextoAab {
  companyId: string;
  repo: Repositorio;
  servicio: Servicio;
  /** Worktree de la sesión y su git. */
  worktree: string;
  gitSesion: { gitDir: string; workTree: string; cwd: string };
  /** Carpeta de la app en la máquina de la persona (donde está su `.env.prod`). */
  origen: string | null;
  tmp: string;
  /** Carpeta de salida del proyecto y el prefijo de URL para descargar. */
  salida: string;
  urlSalida: string;
  sdk: string | null;
  instantanea: () => Promise<string>;
}

async function leerJson<T>(ruta: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(ruta, "utf8")) as T;
  } catch {
    return null;
  }
}

async function leerEnv(ruta: string | null): Promise<Record<string, string>> {
  if (!ruta) return {};
  try {
    return parsearDotenv(await readFile(ruta, "utf8"));
  } catch {
    return {};
  }
}

function archivoDeProduccion(origen: string | null): string | null {
  if (!origen) return null;
  return ARCHIVOS_PRODUCCION.map((a) => join(origen, a)).find((a) => existsSync(a)) ?? null;
}

async function manifiestoDe(aab: string): Promise<ManifiestoAab | null> {
  const buf = await sacarDelZip(aab, "base/manifest/AndroidManifest.xml");
  return buf ? parsearManifiestoProto(buf) : null;
}

/** Las build-tools más nuevas del SDK que traen aapt2 y apksigner. */
async function buildTools(sdk: string | null): Promise<string | null> {
  if (!sdk) return null;
  try {
    const versiones = (await readdir(join(sdk, "build-tools"))).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    const dir = versiones.map((v) => join(sdk, "build-tools", v)).find((d) => existsSync(join(d, "aapt2")) && existsSync(join(d, "apksigner")));
    return dir ?? null;
  } catch {
    return null;
  }
}

function sacarDelZip(zip: string, entrada: string): Promise<Buffer | null> {
  return new Promise((resolver) => {
    execFile("unzip", ["-p", zip, entrada], { encoding: "buffer", maxBuffer: 256 * 1024 * 1024, timeout: 60_000 }, (error, stdout) =>
      resolver(error || stdout.length === 0 ? null : stdout),
    );
  });
}

/**
 * El APK que dejó `assembleRelease`. Con splits por ABI Gradle deja uno por
 * arquitectura: para instalar en cualquier teléfono sirve el universal.
 */
async function apkGenerado(dir: string): Promise<string> {
  const unico = join(dir, "app-release.apk");
  if (existsSync(unico)) return unico;
  const apks = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith(".apk"));
  const universal = apks.find((n) => n.includes("universal"));
  if (universal) return join(dir, universal);
  if (apks.length === 1) return join(dir, apks[0]!);
  throw new Error(
    apks.length
      ? `Gradle dejó un APK por arquitectura (${apks.join(", ")}) y ninguno universal: activá universalApk en los splits para distribuir uno solo.`
      : "Gradle terminó pero no dejó ningún APK.",
  );
}

type EnvAppJson = { expo?: { version?: string; android?: { package?: string; versionCode?: number; blockedPermissions?: string[] } } };

export class ConstructorDeAab {
  private readonly trabajos = new Map<string, TrabajoAab>();
  /** Dónde quedó el AAB de cada trabajo: si alguien lo borra de la salida, el trabajo se olvida. */
  private readonly archivos = new Map<string, string>();

  constructor(private readonly correr: Correr = correrReal) {}

  trabajo(clave: string): TrabajoAab | null {
    const t = this.trabajos.get(clave) ?? null;
    const archivo = this.archivos.get(clave);
    // Mostrar un "AAB listo" con un enlace a un archivo borrado es peor que no mostrar nada.
    if (t?.resultado && archivo && !existsSync(archivo)) {
      this.trabajos.delete(clave);
      this.archivos.delete(clave);
      return null;
    }
    return t;
  }

  private carpetaDeBuilds(ctx: ContextoAab): string {
    return join(ctx.salida, "builds", "android");
  }

  /** Lo que se va a construir y con qué, para que la persona lo mire antes. */
  async plan(ctx: ContextoAab): Promise<PlanDeAab> {
    const dirApp = join(ctx.worktree, ctx.servicio.carpeta);
    const app = await leerJson<EnvAppJson>(join(dirApp, "app.json"));
    const paquete = app?.expo?.android?.package;
    if (!paquete) throw new Error("La app no declara expo.android.package en app.json: no es una app de Expo para Android.");
    const version = app?.expo?.version ?? "0.0.0";
    const versionCode = app?.expo?.android?.versionCode ?? 1;
    const sha = (await git(["rev-parse", "HEAD"], ctx.gitSesion)).stdout.trim();
    const asunto = (await git(["log", "-1", "--format=%s", "HEAD"], ctx.gitSesion)).stdout.trim();
    const rama = (await git(["rev-parse", "--abbrev-ref", "HEAD"], ctx.gitSesion)).stdout.trim();
    const estado = await git(["status", "--porcelain", "--", ctx.servicio.carpeta || "."], { ...ctx.gitSesion, tolerar: true });
    const cambios = estado.stdout.split("\n").filter(Boolean).length;
    const archivoEnv = archivoDeProduccion(ctx.origen);
    const firma = SCRIPTS_DE_FIRMA.find((s) => existsSync(join(dirApp, s))) ?? null;
    const historial = await this.historial(ctx);
    const anterior = await this.anterior(ctx, historial);
    const avisos: string[] = [];
    if (!archivoEnv) {
      avisos.push(
        ctx.origen
          ? `No hay ${ARCHIVOS_PRODUCCION.join(" ni ")} en ${ctx.origen}: sin eso el AAB saldría con las variables de desarrollo.`
          : "El repo no viene de una carpeta local: no hay de dónde leer el .env de producción.",
      );
    }
    if (!firma) avisos.push("El proyecto no trae un script de firma: se usa la configuración de firma que genere el prebuild. Se verifica al final que no sea la de depuración.");
    const minimo = Math.max(versionCode, anterior?.versionCode ?? 0) + 1;
    return {
      paquete,
      version,
      versionCode,
      sugerida: { version: siguienteVersion(version), versionCode: minimo },
      commit: { sha, asunto, rama },
      cambiosSinCommitear: cambios,
      entorno: archivoEnv ? { archivo: archivoEnv, variables: Object.keys(await leerEnv(archivoEnv)) } : null,
      firma,
      anterior,
      historial,
      avisos,
    };
  }

  private async historial(ctx: ContextoAab): Promise<ResultadoAab[]> {
    const dir = this.carpetaDeBuilds(ctx);
    try {
      const nombres = (await readdir(dir)).filter((n) => n.endsWith(".json"));
      const lista = (await Promise.all(nombres.map((n) => leerJson<ResultadoAab>(join(dir, n))))).filter((x): x is ResultadoAab => x != null);
      return lista.sort((a, b) => b.fecha - a.fecha);
    } catch {
      return [];
    }
  }

  /**
   * Borra builds viejos —el archivo y su registro— para que la salida no
   * junte un giga de AAB que nadie va a volver a subir. Por nombre (sólo los
   * que están en el historial: no es una vía para borrar cualquier ruta) o
   * conservando los últimos N.
   *
   * **El más reciente no se borra nunca**: es el "anterior" del próximo build,
   * de donde salen el `versionCode` mínimo y el certificado contra el que se
   * compara. Sin él, el próximo build pierde las dos verificaciones que evitan
   * que Play lo rechace. Tampoco se borra con un build en curso: está por
   * compararse contra ese historial.
   */
  async eliminar(
    clave: string,
    ctx: ContextoAab,
    pedido: { archivos?: string[]; conservar?: number },
  ): Promise<{ borrados: string[]; bytes: number; protegido: string | null }> {
    if (this.trabajos.get(clave)?.estado === "construyendo") {
      throw new Error("Hay un build de producción en curso: se compara contra el historial. Borrá cuando termine.");
    }
    const lista = await this.historial(ctx);
    const protegido = lista[0]?.archivo ?? null;
    let aBorrar: ResultadoAab[];
    if (pedido.conservar != null) {
      aBorrar = lista.slice(Math.max(1, pedido.conservar));
    } else {
      const pedidos = new Set(pedido.archivos ?? []);
      const desconocidos = [...pedidos].filter((n) => !lista.some((b) => b.archivo === n));
      if (desconocidos.length) throw new Error(`No están en el historial: ${desconocidos.join(", ")}.`);
      if (protegido && pedidos.has(protegido)) {
        throw new Error(`${protegido} es el build más reciente: el próximo se compara contra él (versionCode y certificado). No se borra.`);
      }
      aBorrar = lista.filter((b) => pedidos.has(b.archivo));
    }
    const dir = this.carpetaDeBuilds(ctx);
    const borrados: string[] = [];
    let bytes = 0;
    for (const b of aBorrar) {
      const archivo = join(dir, b.archivo);
      bytes += await stat(archivo).then((x) => x.size).catch(() => 0);
      await rm(archivo, { force: true });
      await rm(join(dir, b.archivo.replace(/\.(aab|apk)$/, ".json")), { force: true });
      borrados.push(b.archivo);
    }
    return { borrados, bytes, protegido };
  }

  /**
   * El último AAB conocido: el último que armó el orquestador o, si no hay, el
   * más nuevo que la persona dejó en su carpeta (`build-artifacts/`). De ahí
   * salen el `versionCode` mínimo y el certificado contra el que comparar.
   */
  private async anterior(ctx: ContextoAab, historial: ResultadoAab[]): Promise<PlanDeAab["anterior"]> {
    const ultimo = historial[0];
    if (ultimo) return { archivo: join(this.carpetaDeBuilds(ctx), ultimo.archivo), version: ultimo.version, versionCode: ultimo.versionCode };
    if (!ctx.origen) return null;
    const candidatos: Array<{ ruta: string; mtime: number }> = [];
    for (const sub of ["build-artifacts", "builds", "."]) {
      try {
        for (const n of await readdir(join(ctx.origen, sub))) {
          if (!n.endsWith(".aab")) continue;
          const ruta = join(ctx.origen, sub, n);
          candidatos.push({ ruta, mtime: (await stat(ruta)).mtimeMs });
        }
      } catch {
        // no existe esa carpeta
      }
    }
    const ruta = candidatos.sort((a, b) => b.mtime - a.mtime)[0]?.ruta;
    if (!ruta) return null;
    const m = await manifiestoDe(ruta).catch(() => null);
    return { archivo: ruta, version: m?.versionName ?? null, versionCode: m?.versionCode ?? null };
  }

  construir(
    clave: string,
    ctx: ContextoAab,
    pedido: { version: string; versionCode: number; incluirCambios: boolean; formato?: FormatoAndroid },
    alTerminar: (t: TrabajoAab) => void = () => {},
  ): TrabajoAab {
    const previo = this.trabajos.get(clave);
    // Uno por app, sea AAB o APK: los dos escriben la versión en la sesión.
    if (previo?.estado === "construyendo") throw new Error("Ya hay un build de producción construyéndose para esta app.");
    const etiqueta = (pedido.formato ?? "aab").toUpperCase();
    const t: TrabajoAab = { id: `aab_${randomBytes(4).toString("hex")}`, estado: "construyendo", paso: "Preparando", lineas: [], desde: Date.now(), resultado: null };
    this.trabajos.set(clave, t);
    const anotar = (texto: string) => {
      for (const linea of texto.split("\n")) if (linea.trim()) t.lineas.push(linea.replace(/\u001b\[[0-9;]*m/g, ""));
      if (t.lineas.length > MAX_LINEAS) t.lineas.splice(0, t.lineas.length - MAX_LINEAS);
    };
    const paso = (nombre: string) => {
      t.paso = nombre;
      anotar(`▸ ${nombre}`);
    };
    const dir = join(ctx.tmp, "builds", t.id);
    void this.ejecutar(ctx, pedido, dir, paso, anotar)
      .then((resultado) => {
        t.resultado = resultado;
        this.archivos.set(clave, join(this.carpetaDeBuilds(ctx), resultado.archivo));
        t.estado = resultado.verificaciones.some((v) => v.ok === false) ? "fallo" : "listo";
        t.paso = t.estado === "listo" ? "Listo" : "Verificación fallida";
        anotar(
          t.estado === "listo"
            ? `✓ ${etiqueta} listo: ${resultado.archivo}`
            : `✗ El ${etiqueta} se armó pero no pasó la verificación: no lo ${etiqueta === "AAB" ? "subas a Play" : "distribuyas"}.`,
        );
      })
      .catch((error: unknown) => {
        t.estado = "fallo";
        anotar(`✗ ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(async () => {
        // La carpeta del build pesa cerca de un giga: se va siempre.
        await rm(dir, { recursive: true, force: true }).catch(() => {});
        alTerminar(t);
      });
    return t;
  }

  private async ejecutar(
    ctx: ContextoAab,
    pedido: { version: string; versionCode: number; incluirCambios: boolean; formato?: FormatoAndroid },
    dir: string,
    paso: (nombre: string) => void,
    anotar: (texto: string) => void,
  ): Promise<ResultadoAab> {
    const plan = await this.plan(ctx);
    if (!plan.entorno) throw new Error(plan.avisos[0] ?? "No hay .env de producción.");
    if (!/^\d+\.\d+\.\d+$/.test(pedido.version)) throw new Error(`La versión "${pedido.version}" no es del tipo 1.2.3.`);
    const minimo = Math.max(plan.versionCode, plan.anterior?.versionCode ?? 0);
    if (!Number.isInteger(pedido.versionCode) || pedido.versionCode <= minimo) {
      throw new Error(`El versionCode tiene que ser mayor que ${minimo}: Play rechaza uno que no supere al publicado.`);
    }

    // 1. La copia exacta del código.
    paso(pedido.incluirCambios ? "Tomando una instantánea con los cambios sin commitear" : `Copiando el commit ${plan.commit.sha.slice(0, 8)}`);
    const sha = pedido.incluirCambios ? await ctx.instantanea() : plan.commit.sha;
    await mkdir(dir, { recursive: true });
    const tar = `${dir}.tar`;
    await git(["archive", "--format=tar", `--output=${tar}`, sha, "--", ctx.servicio.carpeta || "."], ctx.gitSesion);
    await this.correrOFallar(["tar", "-xf", tar, "-C", dir], dir, anotar);
    await rm(tar, { force: true });
    const app = join(dir, ctx.servicio.carpeta);

    // 2. Versión.
    paso(`Versión ${pedido.version} (versionCode ${pedido.versionCode})`);
    const appJson = join(app, "app.json");
    await writeFile(appJson, subirVersionEnAppJson(await readFile(appJson, "utf8"), pedido.version, pedido.versionCode));

    // 3. Dependencias: clon copy-on-write de las de la sesión si el lockfile es el mismo.
    paso("Dependencias");
    const sesionApp = join(ctx.worktree, ctx.servicio.carpeta);
    const lock = (d: string) => readFile(join(d, "package-lock.json"), "utf8").catch(() => null);
    const [lockBuild, lockSesion] = await Promise.all([lock(app), lock(sesionApp)]);
    if (lockBuild != null && lockBuild === lockSesion && existsSync(join(sesionApp, "node_modules"))) {
      anotar("node_modules: clon copy-on-write de la sesión (el lockfile es el mismo).");
      await copiarModulos(join(sesionApp, "node_modules"), join(app, "node_modules"));
    } else {
      anotar("El lockfile no coincide con el de la sesión: instalación limpia.");
      await correrEnVivo(argvDeInstalacionLimpia(app), app, entornoDeComando(process.env, ctx.tmp), anotar);
    }

    // 4. El entorno del build: el de producción y nada más.
    const produccion = await leerEnv(plan.entorno.archivo);
    const desarrollo: Record<string, string> = {};
    for (const archivo of ctx.servicio.archivosEntorno) Object.assign(desarrollo, await leerEnv(archivo));
    const java = await detectarJava(this.correr);
    if (!java) throw new Error("No hay un JDK 17: instalá Android Studio o `brew install openjdk@17`.");
    if (!ctx.sdk) throw new Error("No se encontró el SDK de Android (ANDROID_HOME o ~/Library/Android/sdk).");
    const env: NodeJS.ProcessEnv = {
      ...entornoDeComando(process.env, ctx.tmp),
      ...produccion,
      JAVA_HOME: java,
      ANDROID_HOME: ctx.sdk,
      ANDROID_SDK_ROOT: ctx.sdk,
      NODE_ENV: "production",
      // Sin token de Sentry la subida de source maps tumba el build.
      ...(produccion.SENTRY_AUTH_TOKEN ? {} : { SENTRY_DISABLE_AUTO_UPLOAD: "true" }),
    };
    anotar(`Entorno de producción: ${basename(plan.entorno.archivo)} (${Object.keys(produccion).join(", ")}).`);

    // 5. Proyecto nativo, firma y compilación.
    paso("Generando el proyecto nativo (expo prebuild --clean)");
    await correrEnVivo(["npx", "expo", "prebuild", "--platform", "android", "--clean", "--no-install"], app, env, anotar);
    if (plan.firma) {
      paso(`Aplicando la firma de release (${plan.firma})`);
      await correrEnVivo(["node", plan.firma], app, env, anotar);
    }
    const formato: FormatoAndroid = pedido.formato ?? "aab";
    const esApk = formato === "apk";
    const tools = await buildTools(ctx.sdk);
    if (esApk && !tools) throw new Error("No hay build-tools con aapt2 y apksigner en el SDK de Android: sin eso no se puede verificar el APK. Instalalas desde el SDK Manager de Android Studio.");
    const tarea = esApk ? "assembleRelease" : "bundleRelease";
    paso(`Compilando el ${formato.toUpperCase()} (gradlew ${tarea}): tarda varios minutos`);
    await correrEnVivo(["./gradlew", tarea, "--console=plain"], join(app, "android"), env, anotar, CORTE_MS);
    const generado = esApk
      ? await apkGenerado(join(app, "android", "app", "build", "outputs", "apk", "release"))
      : join(app, "android", "app", "build", "outputs", "bundle", "release", "app-release.aab");
    if (!existsSync(generado)) throw new Error(`Gradle terminó pero no dejó app-release.${formato}.`);

    // 6. A la salida del proyecto, con nombre que dice qué es.
    paso("Verificando");
    const nombre = `${plan.paquete.split(".").at(-1)}-${pedido.version}-${pedido.versionCode}.${formato}`;
    const destinoDir = this.carpetaDeBuilds(ctx);
    await mkdir(destinoDir, { recursive: true });
    const destino = join(destinoDir, nombre);
    await copyFile(generado, destino);
    const bytes = await readFile(destino);

    const verificaciones: Verificacion[] = [];
    const manifiesto = esApk
      ? parsearBadging((await this.correr([join(tools!, "aapt2"), "dump", "badging", destino])).salida)
      : await manifiestoDe(destino);
    verificaciones.push({
      nombre: "Paquete y versión",
      ok: manifiesto?.paquete === plan.paquete && manifiesto?.versionCode === pedido.versionCode && manifiesto?.versionName === pedido.version,
      detalle: manifiesto
        ? `${manifiesto.paquete} · versionName ${manifiesto.versionName} · versionCode ${manifiesto.versionCode}`
        : `No se pudo leer el manifiesto del ${formato.toUpperCase()}.`,
    });
    if (plan.anterior?.versionCode != null) {
      verificaciones.push({
        nombre: "versionCode mayor que el anterior",
        ok: (manifiesto?.versionCode ?? 0) > plan.anterior.versionCode,
        detalle: `${manifiesto?.versionCode} contra ${plan.anterior.versionCode} de ${basename(plan.anterior.archivo)}.`,
      });
    }

    // El certificado según qué archivo sea: el anterior puede ser un AAB aunque ahora se arme un APK.
    const keytool = join(java, "bin", "keytool");
    const certificadoDe = async (archivo: string) =>
      archivo.endsWith(".apk")
        ? tools
          ? parsearApksigner((await this.correr([join(tools, "apksigner"), "verify", "--print-certs", archivo])).salida)
          : null
        : parsearCertificado((await this.correr([keytool, "-J-Duser.language=en", "-printcert", "-jarfile", archivo])).salida);
    const cert = await certificadoDe(destino);
    verificaciones.push({
      nombre: "Firmado con la clave de subida",
      ok: cert != null && !/Android Debug/i.test(cert.propietario),
      detalle: !cert
        ? `El ${formato.toUpperCase()} no está firmado.`
        : /Android Debug/i.test(cert.propietario)
          ? "Está firmado con la clave de DEPURACIÓN: Play lo rechaza. Revisá ~/.gradle/gradle.properties y el script de firma."
          : `${cert.propietario}`,
    });
    if (cert && plan.anterior) {
      const certAnterior = await certificadoDe(plan.anterior.archivo);
      if (certAnterior) {
        verificaciones.push({
          nombre: `Mismo certificado que el build anterior (${basename(plan.anterior.archivo)})`,
          ok: certAnterior.sha256 === cert.sha256,
          detalle: certAnterior.sha256 === cert.sha256 ? `SHA256 ${cert.sha256.slice(0, 23)}…` : `Cambió el certificado: ${esApk ? "Android no instala el APK encima de la versión anterior" : "Play rechaza la actualización"}. Antes ${certAnterior.sha256.slice(0, 23)}…, ahora ${cert.sha256.slice(0, 23)}…`,
        });
      }
    }

    const bloqueados = (await leerJson<EnvAppJson>(join(sesionApp, "app.json")))?.expo?.android?.blockedPermissions ?? [];
    const colados = (manifiesto?.permisos ?? []).filter((p) => bloqueados.includes(p));
    verificaciones.push({
      nombre: "Permisos",
      ok: colados.length === 0 ? null : false,
      detalle:
        colados.length > 0
          ? `Aparecen permisos bloqueados en app.json: ${colados.join(", ")}.`
          : `Declarados: ${(manifiesto?.permisos ?? []).map((p) => p.replace("android.permission.", "")).join(", ")}. Revisalos contra la ficha de Play.`,
    });

    const rutaBundle = esApk ? "assets/index.android.bundle" : "base/assets/index.android.bundle";
    const bundle = await sacarDelZip(destino, rutaBundle);
    if (bundle) verificaciones.push(...verificarBundle(bundle, produccion, desarrollo));
    else verificaciones.push({ nombre: "Bundle de JavaScript", ok: false, detalle: `El ${formato.toUpperCase()} no trae ${rutaBundle}.` });

    const resultado: ResultadoAab = {
      formato,
      archivo: nombre,
      url: `${ctx.urlSalida}/builds/android/${encodeURIComponent(nombre)}`,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      version: pedido.version,
      versionCode: pedido.versionCode,
      commit: sha,
      incluyeCambios: pedido.incluirCambios,
      certificado: cert,
      permisos: manifiesto?.permisos ?? [],
      verificaciones,
      fecha: Date.now(),
    };
    await writeFile(join(destinoDir, nombre.replace(/\.(aab|apk)$/, ".json")), `${JSON.stringify(resultado, null, 2)}\n`);

    // 7. La versión nueva queda en la sesión como un cambio de la persona, sin
    // commitear: el próximo build parte de ahí y no reusa el versionCode.
    if (!verificaciones.some((v) => v.ok === false)) {
      const enSesion = join(sesionApp, "app.json");
      const texto = await readFile(enSesion, "utf8");
      const actual = JSON.parse(texto) as EnvAppJson;
      if (actual.expo?.version === plan.version && actual.expo?.android?.versionCode === plan.versionCode) {
        await writeFile(enSesion, subirVersionEnAppJson(texto, pedido.version, pedido.versionCode));
        anotar(`app.json de la sesión quedó en ${pedido.version} (${pedido.versionCode}), sin commitear: commitealo con el release.`);
      } else {
        anotar("⚠ app.json de la sesión cambió durante el build: la versión nueva no se escribió ahí, subila a mano.");
      }
    }
    return resultado;
  }

  private async correrOFallar(argv: string[], cwd: string, anotar: (t: string) => void): Promise<void> {
    await correrEnVivo(argv, cwd, process.env, anotar);
  }
}
