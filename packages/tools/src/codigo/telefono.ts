import { fail, ok, type RegisteredTool } from "../types.js";
import { MAX_PASOS, validarPasos, type PasoDeApp } from "./pasos-app.js";

/**
 * Depurar la app móvil del repo en el teléfono de verdad: logs, estado,
 * archivos y base local, capturas y diagnósticos de Android.
 *
 * **No es un `adb shell` abierto, y eso es la decisión.** El teléfono es el de
 * una persona: tiene sus mensajes, sus fotos y las notificaciones de todas sus
 * apps. Un shell libre dejaba a un agente leer `/sdcard`, el texto de las
 * notificaciones (`dumpsys notification`) o desinstalar cosas. Cada herramienta
 * mira **sólo la app del repo**: los logs por el uid de la app, los archivos
 * por `run-as` (su propio sandbox, y sólo en la build de desarrollo), la
 * captura sólo si la app está en primer plano, y los diagnósticos por una
 * allowlist atada al paquete. Lo destructivo (borrar los datos de la app, que
 * se lleva la cola offline sin sincronizar) pide aprobación.
 *
 * `packages/tools` no sabe de adb: el servidor inyecta el `TelefonoStorage`.
 */

export type Resultado<T> = { ok: true } & T | { ok: false; motivo: string };

export interface TelefonoStorage {
  logs(
    repoId: string | undefined,
    pedido: { alcance: "app" | "fallas"; nivel: "V" | "D" | "I" | "W" | "E"; lineas: number; buscar?: string },
  ): Promise<Resultado<{ texto: string; lineas: number; paquete: string }>>;
  estado(repoId: string | undefined): Promise<Resultado<{ texto: string }>>;
  listarArchivos(repoId: string | undefined, ruta: string): Promise<Resultado<{ texto: string }>>;
  leerArchivo(repoId: string | undefined, ruta: string): Promise<Resultado<{ texto: string }>>;
  consultarBase(repoId: string | undefined, archivo: string, sql: string): Promise<Resultado<{ texto: string }>>;
  captura(repoId: string | undefined): Promise<Resultado<{ ruta: string }>>;
  diagnostico(repoId: string | undefined, comando: string): Promise<Resultado<{ texto: string }>>;
  reiniciar(repoId: string | undefined): Promise<Resultado<{ texto: string }>>;
  limpiarDatos(repoId: string | undefined): Promise<Resultado<{ texto: string }>>;
  /** Lo que hay en la pantalla de la app, en texto. */
  explorar(repoId: string | undefined, buscar: string[]): Promise<Resultado<{ texto: string }>>;
  /**
   * Maneja la app con pasos ya validados. `ok: false` es que no se pudo ni
   * empezar (producción, app cerrada, pantalla apagada); un paso que falla a
   * mitad de camino vuelve con `completo: false` y lo que se alcanzó a hacer.
   */
  actuar(
    repoId: string | undefined,
    pasos: PasoDeApp[],
  ): Promise<Resultado<{ completo: boolean; bitacora: string[]; pantalla: string; fallo?: string }>>;
}

export const HERRAMIENTAS_DE_TELEFONO = [
  "logs_del_telefono",
  "estado_de_la_app",
  "archivos_de_la_app",
  "consultar_base_de_la_app",
  "captura_del_telefono",
  "adb_diagnostico",
  "reiniciar_app",
  "limpiar_datos_de_la_app",
  "explorar_telefono",
  "manejar_app",
] as const;

const REPO = { repo: { type: "string", description: "Nombre o id del repo. Opcional si el proyecto tiene uno solo." } } as const;
const repoDe = (args: Record<string, unknown>) => (typeof args.repo === "string" && args.repo.trim() ? args.repo.trim() : undefined);

export function crearHerramientasDeTelefono(storage: TelefonoStorage): RegisteredTool[] {
  const logs: RegisteredTool = {
    name: "logs_del_telefono",
    description:
      "Los logs de la app móvil del repo en el teléfono conectado (logcat): console.log/error de JavaScript (etiqueta ReactNativeJS), errores nativos y crashes. Sólo los de esta app. Usalo cuando algo falla en el celular: el mensaje de error y el stack están acá, no en el código. alcance='fallas' trae sólo los crashes.",
    inputSchema: {
      type: "object",
      properties: {
        alcance: { type: "string", enum: ["app", "fallas"], description: "app (default): todo lo de la app. fallas: sólo crashes (buffer crash + FATAL)." },
        nivel: { type: "string", enum: ["V", "D", "I", "W", "E"], description: "Nivel mínimo. Default I (incluye console.log de JS)." },
        lineas: { type: "number", description: "Las últimas N líneas (default 200, máx. 1500). Con alcance='fallas', también cuánto de cada backtrace se muestra (la mitad, hasta 160 líneas por crash): subilo para ver qué módulo falló." },
        buscar: { type: "string", description: "Sólo las líneas que contienen este texto (sin distinguir mayúsculas)." },
        ...REPO,
      },
      additionalProperties: false,
    },
    origin: "skill",
    readOnly: true,
    requiresApproval: false,
    async execute(args) {
      const nivel = (["V", "D", "I", "W", "E"] as const).find((n) => n === args.nivel) ?? "I";
      const r = await storage.logs(repoDe(args), {
        alcance: args.alcance === "fallas" ? "fallas" : "app",
        nivel,
        lineas: Math.max(10, Math.min(1500, Number(args.lineas ?? 200) || 200)),
        ...(typeof args.buscar === "string" && args.buscar.trim() ? { buscar: args.buscar.trim() } : {}),
      });
      if (!r.ok) return fail(r.motivo);
      return ok(r.texto || `(sin líneas de ${r.paquete} con ese filtro)`, `${r.lineas} líneas`);
    },
  };

  const estado: RegisteredTool = {
    name: "estado_de_la_app",
    description:
      "Cómo está la app móvil en el teléfono: qué versión está instalada, si está corriendo y en primer plano, memoria, y si tiene los túneles al Metro y a la API de la sesión. Lo primero a mirar cuando 'en el celular no anda'.",
    inputSchema: { type: "object", properties: { ...REPO }, additionalProperties: false },
    origin: "skill",
    readOnly: true,
    requiresApproval: false,
    async execute(args) {
      const r = await storage.estado(repoDe(args));
      return r.ok ? ok(r.texto) : fail(r.motivo);
    },
  };

  const archivos: RegisteredTool = {
    name: "archivos_de_la_app",
    description:
      "Los archivos privados de la app en el teléfono (su sandbox: files/, databases/, shared_prefs/, cache/). accion='listar' una carpeta o accion='leer' un archivo de texto. Sólo funciona con la build de desarrollo (debuggable). Rutas relativas a la carpeta de la app, ej. 'files' o 'shared_prefs/algo.xml'.",
    inputSchema: {
      type: "object",
      properties: {
        accion: { type: "string", enum: ["listar", "leer"] },
        ruta: { type: "string", description: "Relativa a la carpeta de la app. Default '.' (la raíz)." },
        ...REPO,
      },
      required: ["accion"],
      additionalProperties: false,
    },
    origin: "skill",
    readOnly: true,
    requiresApproval: false,
    async execute(args) {
      const ruta = typeof args.ruta === "string" && args.ruta.trim() ? args.ruta.trim() : ".";
      const r = args.accion === "leer" ? await storage.leerArchivo(repoDe(args), ruta) : await storage.listarArchivos(repoDe(args), ruta);
      return r.ok ? ok(r.texto) : fail(r.motivo);
    },
  };

  const base: RegisteredTool = {
    name: "consultar_base_de_la_app",
    description:
      "Consulta de SOLO LECTURA sobre una base SQLite de la app en el teléfono (ej. la cola offline, las cachés). Se copia la base con su WAL y se abre en modo lectura: nada de lo que corras la modifica. Sólo SELECT, PRAGMA de lectura o WITH. Para ver qué bases hay, usá archivos_de_la_app accion='listar' ruta='files/SQLite' o 'databases'.",
    inputSchema: {
      type: "object",
      properties: {
        archivo: { type: "string", description: "Ruta de la base relativa a la carpeta de la app, ej. 'files/SQLite/inspia.db'." },
        sql: { type: "string", description: "Una sola sentencia de lectura, ej. \"SELECT status, count(*) FROM outbox GROUP BY status\"." },
        ...REPO,
      },
      required: ["archivo", "sql"],
      additionalProperties: false,
    },
    origin: "skill",
    readOnly: true,
    requiresApproval: false,
    async execute(args) {
      const r = await storage.consultarBase(repoDe(args), String(args.archivo ?? ""), String(args.sql ?? ""));
      return r.ok ? ok(r.texto) : fail(r.motivo);
    },
  };

  const captura: RegisteredTool = {
    name: "captura_del_telefono",
    description:
      "Saca una captura de la pantalla del teléfono y la guarda en la salida del proyecto (revision/). Sólo si la app del repo está en primer plano: el resto del teléfono es de la persona. Abrila con tus herramientas de lectura para verificar cómo se ve de verdad.",
    inputSchema: { type: "object", properties: { ...REPO }, additionalProperties: false },
    origin: "skill",
    readOnly: false,
    requiresApproval: false,
    async execute(args) {
      const r = await storage.captura(repoDe(args));
      return r.ok ? ok(`Captura guardada en ${r.ruta}.`) : fail(r.motivo);
    },
  };

  const diagnostico: RegisteredTool = {
    name: "adb_diagnostico",
    description:
      "Un comando de diagnóstico de Android sobre la app, de una lista cerrada: 'dumpsys meminfo' (memoria), 'dumpsys gfxinfo' (cuadros lentos, jank), 'dumpsys gfxinfo framestats', 'dumpsys package' (permisos, versión), 'dumpsys batterystats', 'pm path', 'pidof', 'getprop [clave]', 'wm size', 'wm density', 'settings get global|system <clave>', 'df', 'uptime'. El paquete de la app se agrega solo donde corresponde. No es un shell: cualquier otra cosa se rechaza.",
    inputSchema: {
      type: "object",
      properties: { comando: { type: "string", description: "Ej. 'dumpsys gfxinfo' o 'getprop ro.build.version.release'." }, ...REPO },
      required: ["comando"],
      additionalProperties: false,
    },
    origin: "skill",
    readOnly: true,
    requiresApproval: false,
    async execute(args) {
      const r = await storage.diagnostico(repoDe(args), String(args.comando ?? ""));
      return r.ok ? ok(r.texto) : fail(r.motivo);
    },
  };

  const reiniciar: RegisteredTool = {
    name: "reiniciar_app",
    description:
      "Cierra y vuelve a abrir la app en el teléfono, con los túneles al Metro y a la API de la sesión. Para arrancar de cero después de un crash o de un cambio que la recarga en caliente no toma.",
    inputSchema: { type: "object", properties: { ...REPO }, additionalProperties: false },
    origin: "skill",
    readOnly: false,
    requiresApproval: false,
    async execute(args) {
      const r = await storage.reiniciar(repoDe(args));
      return r.ok ? ok(r.texto) : fail(r.motivo);
    },
  };

  const limpiar: RegisteredTool = {
    name: "limpiar_datos_de_la_app",
    description:
      "Borra TODOS los datos de la app en el teléfono (pm clear): sesión, caché, base local y la cola offline que no se haya sincronizado. Pide aprobación a una persona. Usalo sólo si el problema es un estado local corrupto y lo explicás en el motivo.",
    inputSchema: {
      type: "object",
      properties: { motivo: { type: "string", description: "Por qué hace falta borrar los datos." }, ...REPO },
      required: ["motivo"],
      additionalProperties: false,
    },
    origin: "skill",
    readOnly: false,
    requiresApproval: true,
    async execute(args) {
      const r = await storage.limpiarDatos(repoDe(args));
      return r.ok ? ok(r.texto) : fail(r.motivo);
    },
  };

  const explorar: RegisteredTool = {
    name: "explorar_telefono",
    description:
      "Lo que se ve AHORA en la pantalla de la app del repo, en texto: cada elemento con su texto o su descripción de accesibilidad, si se puede tocar y su testID (#id), de arriba abajo. Usalo antes de manejar_app para saber qué nombrar, y después para verificar el resultado. Con «buscar» te dice si esos textos están visibles. Sólo la app del repo en primer plano.",
    inputSchema: {
      type: "object",
      properties: {
        buscar: { type: "array", items: { type: "string" }, description: "Textos que querés confirmar en pantalla (hasta 10), ej. ['Guardar', 'Sin conexión']." },
        ...REPO,
      },
      additionalProperties: false,
    },
    origin: "skill",
    readOnly: true,
    requiresApproval: false,
    async execute(args) {
      const buscar = (Array.isArray(args.buscar) ? args.buscar : [])
        .filter((b): b is string => typeof b === "string" && b.trim() !== "")
        .map((b) => b.trim().slice(0, 120))
        .slice(0, 10);
      const r = await storage.explorar(repoDe(args), buscar);
      return r.ok ? ok(r.texto) : fail(r.motivo);
    },
  };

  const manejar: RegisteredTool = {
    name: "manejar_app",
    description: [
      `Maneja la app del repo en el teléfono como lo haría una persona, con hasta ${MAX_PASOS} pasos en orden. Se nombra lo que se toca (su texto, su descripción de accesibilidad o su testID), nunca coordenadas: el servidor lo ubica en la pantalla de ese momento. Pasos:`,
      "{accion:'tocar_texto', texto, n?, exacto?} — n elige la aparición (1 = la primera de arriba abajo); exacto evita que «Fotos» toque «Fotos del proyecto».",
      "{accion:'esperar_texto', texto, segundos?} — hasta que aparezca y quede quieto (máx. 30 s). Úsalo después de navegar o de guardar.",
      "{accion:'escribir', texto} — en el campo con foco (tocalo antes). Sin el espejo abierto sólo llega ASCII.",
      "{accion:'tecla', tecla:'atras'|'enter'|'tab'|'borrar'} — ojo: 'atras' navega hacia atrás (no sólo cierra el teclado); para pasar al siguiente campo usá 'tab'.",
      "{accion:'deslizar', direccion:'abajo'|'arriba'|'izquierda'|'derecha'} — 'abajo' muestra lo que está más abajo.",
      "{accion:'esperar', segundos} — pausa (máx. 10 s).",
      "Si un paso no encuentra lo que nombraste, se detiene ahí y te dice qué se ve. Devuelve lo hecho y la pantalla final. No funciona si la app apunta a producción ni fuera de la app.",
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        pasos: { type: "array", items: { type: "object" }, description: "Los pasos, en orden (ver la descripción)." },
        ...REPO,
      },
      required: ["pasos"],
      additionalProperties: false,
    },
    origin: "skill",
    readOnly: false,
    requiresApproval: false,
    async execute(args) {
      const v = validarPasos(args.pasos);
      if (!v.ok) return fail(v.motivo);
      const r = await storage.actuar(repoDe(args), v.pasos);
      if (!r.ok) return fail(r.motivo);
      const informe = [
        r.bitacora.length ? `Hecho:\n${r.bitacora.join("\n")}` : "No se alcanzó a hacer ningún paso.",
        ...(r.fallo ? [`Se detuvo en: ${r.fallo}`] : []),
        `Pantalla ${r.completo ? "final" : "al detenerse"}:\n${r.pantalla}`,
      ].join("\n\n");
      return r.completo ? ok(informe, `${r.bitacora.length} pasos`) : fail(informe);
    },
  };

  return [logs, estado, archivos, base, captura, diagnostico, reiniciar, limpiar, explorar, manejar];
}
