import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { Repositorio, Servicio } from "@orq/shared";
import { tokenizar } from "@orq/shared";
import type { TelefonoStorage } from "@orq/tools";
import type { Dispositivos } from "./dispositivos.js";
import { paqueteDeLaApp } from "./dispositivos.js";
import { consolaJs } from "./inspector-rn.js";

/**
 * Lo que el servidor le presta a las herramientas de depuración del teléfono
 * (`packages/tools/src/codigo/telefono.ts`): adb acotado a la app del repo.
 *
 * Toda la seguridad vive acá y no en el prompt. Las funciones puras de abajo
 * —qué ruta se acepta, qué SQL es de lectura, qué diagnóstico está permitido,
 * qué se tapa de un log— están exportadas para fijarlas con tests.
 */

const TOPE_SALIDA = 15_000;

// --- Reglas puras -----------------------------------------------------------------

/**
 * Lo que no puede salir en un log que lee un agente: los JWT (la sesión de
 * Supabase viaja así), los `Bearer`, las claves secretas de Supabase y las
 * `apikey=` en URLs.
 */
export function taparSecretos(texto: string): string {
  return texto
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "‹jwt tapado›")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, "$1‹tapado›")
    .replace(/sb_secret_[A-Za-z0-9_-]+/g, "‹clave tapada›")
    .replace(/((?:apikey|api_key|token|access_token|refresh_token)=)[^&\s"']+/gi, "$1‹tapado›");
}

/**
 * Una ruta dentro del sandbox de la app: relativa, sin `..`, con caracteres
 * que la shell del teléfono no interpreta (se pasa sin comillas a `run-as`).
 */
export function validarRutaDeApp(ruta: string): { ok: true; ruta: string } | { ok: false; motivo: string } {
  const limpia = ruta.trim().replace(/^\.\/+/, "").replace(/\/+$/, "") || ".";
  if (limpia.startsWith("/")) return { ok: false, motivo: "La ruta es relativa a la carpeta de la app (ej. 'files/SQLite'), no absoluta." };
  if (!/^[A-Za-z0-9._\-/]+$/.test(limpia)) return { ok: false, motivo: "La ruta sólo puede tener letras, números, '.', '_', '-' y '/'." };
  if (limpia.split("/").some((s) => s === "..")) return { ok: false, motivo: "La ruta no puede salir de la carpeta de la app ('..')." };
  return { ok: true, ruta: limpia };
}

/**
 * Una sola sentencia de lectura. La base es una **copia** y se abre con
 * `-readonly -safe`, así que esto no es la única barrera; es la que explica.
 * Un `.` al principio es un comando del cliente sqlite3 (`.shell`), no SQL.
 */
export function validarSqlDeLectura(sql: string): { ok: true; sql: string } | { ok: false; motivo: string } {
  const limpia = sql.trim().replace(/;\s*$/, "");
  if (!limpia) return { ok: false, motivo: "Falta la consulta." };
  if (limpia.includes(";")) return { ok: false, motivo: "Una sola sentencia por consulta." };
  if (/^\s*\./.test(limpia)) return { ok: false, motivo: "Los comandos con punto del cliente sqlite3 no se aceptan: sólo SQL." };
  if (!/^\s*(select|with|pragma|explain)\b/i.test(limpia)) return { ok: false, motivo: "Sólo consultas de lectura: SELECT, WITH, PRAGMA o EXPLAIN." };
  if (/^\s*pragma\b[^=]*=/i.test(limpia)) return { ok: false, motivo: "Un PRAGMA con '=' cambia la base: sólo PRAGMA de lectura." };
  if (/\b(attach|load_extension)\b/i.test(limpia)) return { ok: false, motivo: "ATTACH y load_extension no se aceptan." };
  return { ok: true, sql: limpia };
}

const SUBSISTEMAS_DE_LA_APP = new Set(["meminfo", "gfxinfo", "package", "batterystats"]);
const SETTINGS_PERMITIDOS = new Set(["global", "system"]);

/**
 * La allowlist de `adb_diagnostico`, por token. Todo lo que es de una app va
 * atado al paquete del repo: `dumpsys meminfo` de otra app, o `dumpsys
 * notification` (el texto de los mensajes de la persona), no pasan.
 */
export function validarDiagnostico(comando: string, paquete: string): { ok: true; argv: string[] } | { ok: false; motivo: string } {
  const t = tokenizar(comando);
  if (!t.ok) return { ok: false, motivo: `No se pudo leer el comando: ${t.motivo}` };
  const argv = t.argv[0] === "adb" ? (t.argv[1] === "shell" ? t.argv.slice(2) : t.argv.slice(1)) : t.argv;
  const [cmd, a1, a2, ...resto] = argv;
  const seguro = argv.every((x) => /^[A-Za-z0-9._:/=,+@%-]+$/.test(x));
  if (!cmd || !seguro) return { ok: false, motivo: "Comando vacío o con caracteres que no se aceptan." };

  if (cmd === "dumpsys" && a1 && SUBSISTEMAS_DE_LA_APP.has(a1)) {
    if (a2 && a2 !== paquete) return { ok: false, motivo: `dumpsys ${a1} sólo sobre la app del repo (${paquete}).` };
    const extra = a1 === "gfxinfo" && (resto[0] === "framestats" || resto[0] === "reset") ? [resto[0]] : [];
    if (resto.length > extra.length) return { ok: false, motivo: `Argumentos de más para dumpsys ${a1}.` };
    return { ok: true, argv: ["dumpsys", a1, paquete, ...extra] };
  }
  if (cmd === "getprop" && argv.length <= 2) return { ok: true, argv };
  if (cmd === "wm" && (a1 === "size" || a1 === "density") && argv.length === 2) return { ok: true, argv };
  if (cmd === "pm" && (a1 === "path" || a1 === "dump") && argv.length <= 3) {
    if (a2 && a2 !== paquete) return { ok: false, motivo: `pm ${a1} sólo sobre la app del repo (${paquete}).` };
    return { ok: true, argv: ["pm", a1, paquete] };
  }
  if (cmd === "pidof" && argv.length <= 2) {
    if (a1 && a1 !== paquete) return { ok: false, motivo: `pidof sólo de la app del repo (${paquete}).` };
    return { ok: true, argv: ["pidof", paquete] };
  }
  if (cmd === "settings" && a1 === "get" && a2 && SETTINGS_PERMITIDOS.has(a2) && resto.length === 1) return { ok: true, argv };
  if ((cmd === "df" || cmd === "uptime") && argv.length <= 2 && (!a1 || a1 === "-h")) return { ok: true, argv };
  return {
    ok: false,
    motivo:
      "Ese comando no está permitido. Se aceptan: dumpsys meminfo|gfxinfo [framestats|reset]|package|batterystats, pm path|dump, pidof, getprop [clave], wm size|density, settings get global|system <clave>, df, uptime. Los logs van por logs_del_telefono y los archivos por archivos_de_la_app.",
  };
}

/** `package:co.codla.inspia uid:10582` → 10582. */
export function uidDe(salida: string): number | null {
  const m = /uid:(\d+)/.exec(salida);
  return m ? Number(m[1]) : null;
}

/** El nombre de paquete de la actividad en primer plano, de `dumpsys activity activities`. */
export function paqueteEnPrimerPlano(salida: string): string | null {
  const m = /(?:topResumedActivity|mResumedActivity|ResumedActivity)[^\n]*?\s([a-zA-Z0-9_.]+)\/[\w.$]+/.exec(salida);
  return m?.[1] ?? null;
}

const ORDEN_NIVEL = "VDIWEF";

/**
 * Las líneas de la app en un logcat `-v uid`, sin la columna del uid. Se lee
 * todo el buffer y se filtra acá —el `--uid` de logcat no devuelve nada del
 * buffer principal en el Samsung medido— y lo de las otras apps no sale de
 * esta función. Incluye los procesos anteriores de la app: el que crasheó ya no
 * tiene pid.
 */
export function lineasDeLaApp(salida: string, uid: number, nivelMinimo: string): string[] {
  const minimo = ORDEN_NIVEL.indexOf(nivelMinimo);
  const lineas: string[] = [];
  for (const linea of salida.split("\n")) {
    const m = /^(\d\d-\d\d \d\d:\d\d:\d\d\.\d+)\s+(\S+)\s+(\d+\s+\d+)\s+([VDIWEF])\s(.*)$/.exec(linea.trimEnd());
    if (!m || (m[2] !== String(uid) && m[2] !== `u0_a${uid - 10_000}`)) continue;
    if (ORDEN_NIVEL.indexOf(m[4]!) < minimo) continue;
    lineas.push(`${m[1]} ${m[3]} ${m[4]} ${m[5]}`);
  }
  return lineas;
}

/**
 * Los últimos crashes del buffer `crash`, cada uno **desde su comienzo** —la
 * señal, la causa, el hilo, el principio del backtrace—: el final de un
 * tombstone son cien marcos de libart que no dicen nada.
 */
export function ultimasFallas(salida: string, cuantas = 3, lineasPorFalla = 45): string[] {
  // Los registros del procesador (x0…x28, lr, sp, pc) no le dicen nada a quien
  // programa la app, y ocupan el lugar del backtrace, que sí dice dónde falló.
  const registro = /:\s+(?:(?:x\d+|lr|sp|pc|pst|esr)\s+[0-9a-f]{8,}\s*)+$/i;
  const lineas = salida.split("\n").filter((l) => l.trim() && !l.startsWith("--------- beginning of") && !registro.test(l));
  const inicios: number[] = [];
  lineas.forEach((l, i) => {
    const empieza = /Fatal signal|FATAL EXCEPTION|\*\*\* \*\*\* \*\*\*/.test(l);
    // El "Fatal signal" y el encabezado del tombstone son la misma falla.
    if (empieza && !(inicios.length && i - inicios[inicios.length - 1]! <= 2)) inicios.push(i);
  });
  return inicios.slice(-cuantas).map((inicio, k, todos) => {
    const fin = k + 1 < todos.length ? todos[k + 1]! : lineas.length;
    const tramo = lineas.slice(inicio, fin);
    return tramo.length > lineasPorFalla ? [...tramo.slice(0, lineasPorFalla), `(… ${tramo.length - lineasPorFalla} líneas más del backtrace)`].join("\n") : tramo.join("\n");
  });
}

const NIVEL_JS: Record<string, string> = { debug: "D", log: "I", info: "I", warn: "W", warning: "W", error: "E", excepcion: "E", assert: "E", trace: "D" };

/** Un marco de backtrace sin el ruido: la ruta hasheada del APK y el BuildId. */
export function limpiarMarco(linea: string): string {
  return linea
    .replace(/\/data\/app\/[^ ]*?\/base\.apk!/g, "base.apk!")
    .replace(/\s*\(offset 0x[0-9a-f]+\)/gi, "")
    .replace(/\s*\(BuildId: [0-9a-f]+\)/gi, "");
}

function acotar(texto: string, tope = TOPE_SALIDA, conservar: "final" | "principio" = "final"): string {
  if (texto.length <= tope) return texto;
  if (conservar === "principio") return `${texto.slice(0, tope)}\n(…recortado: ${texto.length - tope} caracteres más)`;
  // Lo último de un log es lo que importa: el error está al final.
  return `(…se muestran los últimos ${tope} caracteres de ${texto.length})\n${texto.slice(-tope)}`;
}

// --- La implementación ------------------------------------------------------------

export interface DepsDepuracion {
  dispositivos: Dispositivos;
  /** El repo por nombre o id (o el único del proyecto) con la carpeta de su sesión. */
  resolverRepo(repo: string | undefined): { ok: true; repo: Repositorio; worktree: string } | { ok: false; motivo: string };
  /** Carpeta temporal del proyecto. */
  tmp: string;
  /** Guarda una imagen en la salida del proyecto y devuelve su ruta relativa. */
  guardarEnSalida(nombre: string, carpeta: string, bytes: Buffer): Promise<string>;
  /** El puerto del Metro de la app, si está levantado: de ahí sale la consola de JavaScript. */
  metroDe(repo: Repositorio, servicio: Servicio): number | null;
  /** Reabre la app con sus túneles (lo mismo que "Abrir la app" en el IDE). */
  reabrir(repo: Repositorio, servicio: Servicio, serial: string): Promise<void>;
}

interface Objetivo {
  repo: Repositorio;
  servicio: Servicio;
  paquete: string;
  serial: string;
}

export function crearTelefonoStorage(deps: DepsDepuracion): TelefonoStorage {
  const objetivo = async (repoArg: string | undefined): Promise<{ ok: true; o: Objetivo } | { ok: false; motivo: string }> => {
    const r = deps.resolverRepo(repoArg);
    if (!r.ok) return r;
    const servicio = r.repo.servicios.find((s) => s.tipo === "movil");
    if (!servicio) return { ok: false, motivo: `El repo ${r.repo.nombre} no tiene una app móvil detectada.` };
    const paquete = await paqueteDeLaApp(join(r.worktree, servicio.carpeta));
    if (!paquete) return { ok: false, motivo: "La app no declara su paquete de Android (expo.android.package en app.json)." };
    const tel = await deps.dispositivos.telefonoPara(r.repo.id);
    if (!tel.ok) return tel;
    return { ok: true, o: { repo: r.repo, servicio, paquete, serial: tel.serial } };
  };
  const shell = (o: Objetivo, args: string[], corteMs?: number) => deps.dispositivos.adbTexto(o.serial, ["shell", ...args], corteMs);
  const noDepurable = (salida: string) =>
    /not debuggable|is unknown|Could not set capabilities/i.test(salida)
      ? "La app instalada no es la build de desarrollo (no es debuggable): sus archivos sólo se pueden leer con la build de desarrollo. Instalala desde la pestaña Mobile → Dispositivos."
      : null;

  return {
    async logs(repoArg, pedido) {
      const r = await objetivo(repoArg);
      if (!r.ok) return r;
      const { o } = r;
      const uid = uidDe((await shell(o, ["pm", "list", "packages", "-U", "--user", "current", o.paquete])).salida);
      if (uid == null) return { ok: false, motivo: `${o.paquete} no está instalada en el teléfono.` };
      const aguja = pedido.buscar?.toLowerCase();
      const pasa = (l: string) => !aguja || l.toLowerCase().includes(aguja);

      // JavaScript: del depurador de Hermes, porque no pasa por logcat.
      const metro = deps.metroDe(o.repo, o.servicio);
      const consola = metro != null ? consolaJs(metro) : null;
      const minimo = ORDEN_NIVEL.indexOf(pedido.alcance === "fallas" ? "E" : pedido.nivel);
      const js = (consola?.leer() ?? [])
        .filter((e) => ORDEN_NIVEL.indexOf(NIVEL_JS[e.nivel] ?? "I") >= minimo)
        .map((e) => `${new Date(e.at).toLocaleTimeString("es-AR", { hour12: false })} ${e.nivel.toUpperCase()} ${e.texto}`)
        .filter(pasa)
        .slice(-pedido.lineas);
      const avisoJs =
        consola == null
          ? "(el servicio móvil no está levantado: sin su Metro no se ve la consola de JavaScript)"
          : consola.estado !== "conectada"
            ? "(conectando con la consola de JavaScript de la app; si no aparece, la app no está conectada al Metro: reiniciar_app)"
            : "(sin mensajes de consola con ese filtro)";

      let nativo: string[];
      if (pedido.alcance === "fallas") {
        const crash = (await shell(o, ["logcat", "-d", "-b", "crash", "-v", "threadtime", `--uid=${uid}`], 30_000)).salida;
        // `lineas` también amplía cada crash: el módulo que falló (libworklets,
        // libexpo-sqlite…) suele aparecer más abajo que los primeros marcos.
        const porFalla = Math.max(30, Math.min(160, Math.round(pedido.lineas / 2)));
        nativo = ultimasFallas(crash, 3, porFalla).map((f) => f.split("\n").map(limpiarMarco).join("\n")).filter(pasa);
      } else {
        const salida = (await shell(o, ["logcat", "-d", "-v", "uid", "-t", String(Math.min(40_000, pedido.lineas * 40))], 30_000)).salida;
        nativo = lineasDeLaApp(salida, uid, pedido.nivel).filter(pasa).slice(-pedido.lineas);
      }
      const secciones = [
        `=== JavaScript (consola de la app) ===\n${js.length ? js.join("\n") : avisoJs}`,
        pedido.alcance === "fallas"
          ? `=== Crashes nativos (los últimos, desde su comienzo) ===\n${nativo.length ? nativo.join("\n\n") : "(ninguno en el buffer de crashes)"}`
          : `=== Nativo (logcat de la app) ===\n${nativo.length ? nativo.join("\n") : "(sin líneas con ese filtro)"}`,
      ];
      // En un crash lo que importa es el principio (señal, causa, hilo); en un log, lo último.
      const texto = acotar(taparSecretos(secciones.join("\n\n")), TOPE_SALIDA, pedido.alcance === "fallas" ? "principio" : "final");
      return { ok: true, paquete: o.paquete, lineas: js.length + nativo.length, texto };
    },

    async estado(repoArg) {
      const r = await objetivo(repoArg);
      if (!r.ok) return r;
      const { o } = r;
      const [paquete, pid, actividad, memoria, tuneles, modelo, android, energia] = await Promise.all([
        shell(o, ["dumpsys", "package", o.paquete]),
        shell(o, ["pidof", o.paquete]),
        shell(o, ["dumpsys", "activity", "activities"]),
        shell(o, ["dumpsys", "meminfo", o.paquete]),
        deps.dispositivos.adbTexto(o.serial, ["reverse", "--list"]),
        shell(o, ["getprop", "ro.product.model"]),
        shell(o, ["getprop", "ro.build.version.release"]),
        shell(o, ["dumpsys", "power"]),
      ]);
      const vigilia = /mWakefulness=(\w+)/.exec(energia.salida)?.[1] ?? "?";
      const campo = (re: RegExp) => re.exec(paquete.salida)?.[1]?.trim() ?? "?";
      const instalada = /versionName=/.test(paquete.salida);
      const enFrente = paqueteEnPrimerPlano(actividad.salida) === o.paquete;
      const pss = /TOTAL PSS:\s*([\d,]+)/.exec(memoria.salida)?.[1] ?? /TOTAL\s+([\d,]+)/.exec(memoria.salida)?.[1];
      const lineas = [
        `Teléfono: ${modelo.salida.trim()} · Android ${android.salida.trim()} (${o.serial}) · pantalla ${vigilia === "Awake" ? "encendida" : `apagada (${vigilia}): una app con la pantalla apagada puede quedar en pausa`}`,
        `App: ${o.paquete}${instalada ? ` · versión ${campo(/versionName=(\S+)/)} (versionCode ${campo(/versionCode=(\d+)/)}) · actualizada ${campo(/lastUpdateTime=([^\n]+)/)}` : " · NO instalada"}`,
        `Depurable (build de desarrollo): ${/flags=\[[^\]]*DEBUGGABLE/.test(paquete.salida) ? "sí" : "no"}`,
        `Proceso: ${pid.salida.trim() ? `corriendo (pid ${pid.salida.trim()})` : "no está corriendo"} · primer plano: ${enFrente ? "sí" : "no"}`,
        ...(pss ? [`Memoria (PSS total): ${pss} KB`] : []),
        `Túneles (adb reverse): ${tuneles.salida.trim() ? tuneles.salida.trim().split("\n").map((l) => l.replace(/^\S+\s+/, "")).join(", ") : "ninguno — la app no ve el Metro ni la API de la sesión; usá reiniciar_app"}`,
      ];
      return { ok: true, texto: lineas.join("\n") };
    },

    async listarArchivos(repoArg, ruta) {
      const v = validarRutaDeApp(ruta);
      if (!v.ok) return v;
      const r = await objetivo(repoArg);
      if (!r.ok) return r;
      const out = await shell(r.o, ["run-as", r.o.paquete, "ls", "-la", v.ruta]);
      const falla = noDepurable(out.salida);
      if (falla) return { ok: false, motivo: falla };
      if (out.codigo !== 0) return { ok: false, motivo: out.salida.trim().slice(0, 400) || "No se pudo listar." };
      return { ok: true, texto: acotar(out.salida.trim()) };
    },

    async leerArchivo(repoArg, ruta) {
      const v = validarRutaDeApp(ruta);
      if (!v.ok) return v;
      const r = await objetivo(repoArg);
      if (!r.ok) return r;
      let bytes: Buffer;
      try {
        bytes = await deps.dispositivos.adbBinario(r.o.serial, ["exec-out", "run-as", r.o.paquete, "cat", v.ruta]);
      } catch (error) {
        const texto = error instanceof Error ? error.message : String(error);
        return { ok: false, motivo: noDepurable(texto) ?? texto.slice(0, 400) };
      }
      const falla = noDepurable(bytes.subarray(0, 300).toString());
      if (falla) return { ok: false, motivo: falla };
      if (bytes.subarray(0, 8000).includes(0)) {
        return {
          ok: true,
          texto: `${v.ruta} es binario (${bytes.length} bytes).${/\.db$|sqlite/i.test(v.ruta) ? " Es una base: consultala con consultar_base_de_la_app." : ""}`,
        };
      }
      return { ok: true, texto: acotar(taparSecretos(bytes.toString("utf8"))) };
    },

    async consultarBase(repoArg, archivo, sql) {
      const v = validarRutaDeApp(archivo);
      if (!v.ok) return v;
      const q = validarSqlDeLectura(sql);
      if (!q.ok) return q;
      const r = await objetivo(repoArg);
      if (!r.ok) return r;
      const dir = join(deps.tmp, `sqlite-${randomBytes(4).toString("hex")}`);
      await mkdir(dir, { recursive: true });
      try {
        const local = join(dir, "base.db");
        // Con journal WAL lo último escrito vive en -wal: copiar sólo el .db
        // mostraría la base de hace un rato sin avisar.
        for (const sufijo of ["", "-wal", "-shm"]) {
          try {
            const bytes = await deps.dispositivos.adbBinario(r.o.serial, ["exec-out", "run-as", r.o.paquete, "cat", `${v.ruta}${sufijo}`]);
            const falla = noDepurable(bytes.subarray(0, 300).toString());
            if (falla) return { ok: false, motivo: falla };
            if (sufijo === "" && !bytes.subarray(0, 16).toString().startsWith("SQLite format 3")) {
              return { ok: false, motivo: `${v.ruta} no es una base SQLite (o no existe): ${bytes.subarray(0, 200).toString().trim()}` };
            }
            if (bytes.length > 0 && !/No such file/i.test(bytes.subarray(0, 200).toString())) await writeFile(`${local}${sufijo}`, bytes);
          } catch (error) {
            if (sufijo === "") return { ok: false, motivo: error instanceof Error ? error.message : String(error) };
          }
        }
        const salida = await new Promise<{ ok: boolean; texto: string }>((resolver) =>
          execFile(
            "sqlite3",
            ["-readonly", "-safe", "-header", "-box", local, q.sql],
            { timeout: 20_000, maxBuffer: 16 * 1024 * 1024 },
            (error, stdout, stderr) => resolver({ ok: !error, texto: error ? String(stderr || error.message) : String(stdout) }),
          ),
        );
        if (!salida.ok) return { ok: false, motivo: salida.texto.trim().slice(0, 600) };
        return { ok: true, texto: acotar(taparSecretos(salida.texto.trim() || "(sin filas)")) };
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },

    async captura(repoArg) {
      const r = await objetivo(repoArg);
      if (!r.ok) return r;
      const actividad = await shell(r.o, ["dumpsys", "activity", "activities"]);
      // El resto del teléfono es de la persona: sin la app al frente, no hay captura.
      if (paqueteEnPrimerPlano(actividad.salida) !== r.o.paquete) {
        return { ok: false, motivo: "La app del repo no está en primer plano: la captura sólo se saca de la app, no del resto del teléfono. Abrila con reiniciar_app." };
      }
      const energia = await shell(r.o, ["dumpsys", "power"]);
      if (!/mWakefulness=Awake/.test(energia.salida)) {
        return { ok: false, motivo: "La pantalla del teléfono está apagada: la captura saldría negra. Que una persona lo desbloquee." };
      }
      const png = await deps.dispositivos.adbBinario(r.o.serial, ["exec-out", "screencap", "-p"]);
      const nombre = `telefono-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
      return { ok: true, ruta: await deps.guardarEnSalida(nombre, "revision", png) };
    },

    async diagnostico(repoArg, comando) {
      const r = await objetivo(repoArg);
      if (!r.ok) return r;
      const v = validarDiagnostico(comando, r.o.paquete);
      if (!v.ok) return v;
      const out = await shell(r.o, v.argv, 30_000);
      return { ok: true, texto: acotar(taparSecretos(`$ ${v.argv.join(" ")}\n${out.salida.trim() || "(sin salida)"}`)) };
    },

    async reiniciar(repoArg) {
      const r = await objetivo(repoArg);
      if (!r.ok) return r;
      try {
        await deps.reabrir(r.o.repo, r.o.servicio, r.o.serial);
      } catch (error) {
        return { ok: false, motivo: error instanceof Error ? error.message : String(error) };
      }
      return { ok: true, texto: `${r.o.paquete} reabierta con sus túneles al Metro y a la API de la sesión. Mirá logs_del_telefono en unos segundos.` };
    },

    async limpiarDatos(repoArg) {
      const r = await objetivo(repoArg);
      if (!r.ok) return r;
      const out = await shell(r.o, ["pm", "clear", "--user", "current", r.o.paquete]);
      if (!/Success/i.test(out.salida)) return { ok: false, motivo: out.salida.trim().slice(0, 400) || "pm clear no confirmó." };
      return { ok: true, texto: `Se borraron los datos de ${r.o.paquete} (sesión, caché y base local). Al abrirla arranca como recién instalada.` };
    },
  };
}
