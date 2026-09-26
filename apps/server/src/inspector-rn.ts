import { request } from "node:http";
import { randomBytes } from "node:crypto";

/**
 * Qué componentes de React dibujan lo que la persona señaló en el teléfono.
 *
 * El árbol de accesibilidad (`uiautomator`) dice qué hay en pantalla —el texto,
 * la descripción, dónde está— pero no quién lo dibuja. Eso lo sabe la app: en
 * desarrollo, React Native expone el depurador de Hermes por el Metro de la
 * sesión (`/json/list` → `/inspector/debug`), y con un `Runtime.evaluate` se
 * recorre el árbol de fibras buscando el texto señalado. Sale la cadena de
 * componentes, con la pantalla de expo-router y su archivo
 * (`LoginScreen(./login.tsx)`), que es lo que el chat necesita para ir derecho
 * al código.
 *
 * Dos detalles que no se ven: Metro rechaza el WebSocket sin cabecera
 * `Origin` local, y el `WebSocket` nativo de Node no deja ponerla; por eso hay
 * un cliente mínimo acá. Y todo es de mejor esfuerzo: sin depurador (una build
 * de release, el depurador abierto por otro lado) el elemento igual va al chat
 * con lo que dijo la accesibilidad.
 */

const CORTE_MS = 8_000;

export interface Conexion {
  enviar(texto: string): void;
  alRecibir(f: (texto: string) => void): void;
  alCerrar(f: () => void): void;
  cerrar(): void;
}

/** Un WebSocket de texto, lo justo para CDP: con `Origin` y enmascarado. */
export function abrirWebSocket(url: string, origen: string): Promise<Conexion> {
  return new Promise((resolver, rechazar) => {
    const u = new URL(url);
    const req = request({
      host: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": randomBytes(16).toString("base64"),
        Origin: origen,
      },
    });
    req.on("upgrade", (_res, socket) => {
      let buf = Buffer.alloc(0);
      const oyentes: Array<(t: string) => void> = [];
      let fragmentos: Buffer[] = [];
      socket.on("data", (d: Buffer) => {
        buf = Buffer.concat([buf, d]);
        for (;;) {
          if (buf.length < 2) return;
          let largo = buf[1]! & 127;
          let desde = 2;
          if (largo === 126) {
            if (buf.length < 4) return;
            largo = buf.readUInt16BE(2);
            desde = 4;
          } else if (largo === 127) {
            if (buf.length < 10) return;
            largo = Number(buf.readBigUInt64BE(2));
            desde = 10;
          }
          if (buf.length < desde + largo) return;
          const fin = (buf[0]! & 0x80) !== 0;
          const op = buf[0]! & 15;
          const datos = buf.subarray(desde, desde + largo);
          buf = buf.subarray(desde + largo);
          if (op === 1 || op === 0) {
            fragmentos.push(Buffer.from(datos));
            if (fin) {
              const texto = Buffer.concat(fragmentos).toString("utf8");
              fragmentos = [];
              for (const f of oyentes) f(texto);
            }
          }
        }
      });
      socket.on("error", () => {});
      const cierres: Array<() => void> = [];
      socket.on("close", () => cierres.forEach((f) => f()));
      resolver({
        alCerrar(f) {
          cierres.push(f);
        },
        enviar(texto) {
          const carga = Buffer.from(texto);
          const mascara = randomBytes(4);
          let cabecera: Buffer;
          if (carga.length < 126) cabecera = Buffer.from([0x81, 0x80 | carga.length]);
          else if (carga.length < 65_536) {
            cabecera = Buffer.alloc(4);
            cabecera[0] = 0x81;
            cabecera[1] = 0x80 | 126;
            cabecera.writeUInt16BE(carga.length, 2);
          } else {
            cabecera = Buffer.alloc(10);
            cabecera[0] = 0x81;
            cabecera[1] = 0x80 | 127;
            cabecera.writeBigUInt64BE(BigInt(carga.length), 2);
          }
          const enmascarada = Buffer.alloc(carga.length);
          for (let i = 0; i < carga.length; i++) enmascarada[i] = carga[i]! ^ mascara[i % 4]!;
          socket.write(Buffer.concat([cabecera, mascara, enmascarada]));
        },
        alRecibir(f) {
          oyentes.push(f);
        },
        cerrar() {
          socket.destroy();
        },
      });
    });
    req.on("response", (r) => rechazar(new Error(`El depurador contestó ${r.statusCode}.`)));
    req.on("error", rechazar);
    req.setTimeout(CORTE_MS, () => req.destroy(new Error("El depurador no contestó.")));
    req.end();
  });
}

export interface ComponentesEnPantalla {
  /** Del más cercano al más lejano, sin los internos de React Native. */
  componentes: string[];
  /** Archivos de pantalla que nombra expo-router (`./login.tsx`). */
  pantallas: string[];
}

/** Lo que React Native pone en la cadena y nadie edita. */
const INTERNOS = new Set([
  "Text", "TextImpl", "View", "ViewImpl", "Pressable", "ScrollView", "ScrollViewContext", "KeyboardAvoidingView", "TouchableOpacity",
  "TouchableHighlight", "TouchableWithoutFeedback", "Animated", "AnimatedComponent", "TextInput", "Image", "ImageBackground", "FlatList",
  "VirtualizedList", "SafeAreaView", "SafeAreaProvider", "Route", "RouteNode", "WrappedScreenComponent", "ZoomTransitionTargetContextProvider",
  "Screen", "ScreenStack", "Navigator", "NavigationContent", "StaticContainer", "SceneView", "Background", "MaybeScreen", "MaybeScreenContainer",
  "ExpoRoot", "ContextNavigator", "EnsureSingleNavigator", "DebugContainer", "Suspender", "Freeze", "DelayedFreeze", "InnerScreen", "ThemeProvider", "AppContainer", "LogBoxStateSubscription", "RootComponent", "Suspense", "Fragment",
]);

/**
 * Nombres limpios: `LoginScreen(./login.tsx)` → componente `LoginScreen` y
 * pantalla `./login.tsx`; `Route(login)` y los internos, afuera.
 */
export function limpiarCadena(cadena: string[]): ComponentesEnPantalla {
  const componentes: string[] = [];
  const pantallas: string[] = [];
  for (const crudo of cadena) {
    const m = /^([A-Za-z_$][\w$]*)(?:\((.*)\))?$/.exec(crudo.trim());
    if (!m) continue;
    const [, nombre, extra] = m as unknown as [string, string, string | undefined];
    if (extra && /\.(t|j)sx?$/.test(extra) && !pantallas.includes(extra)) pantallas.push(extra);
    if (INTERNOS.has(nombre) || /^(Animated|Reanimated|RN|Expo|Native|Safe|Gesture|Screen)/.test(nombre) || /Provider$|Context$/.test(nombre)) continue;
    if (!componentes.includes(nombre)) componentes.push(nombre);
  }
  return { componentes, pantallas };
}

/**
 * Busca en las fibras vivas el componente que dibuja alguno de estos textos
 * (el texto visible, el placeholder de un campo, la etiqueta de accesibilidad).
 * Corre adentro de la app: es JavaScript autocontenido, sin nada de afuera.
 */
function expresion(buscados: string[]): string {
  return `(function (buscados) {
  var h = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!h || !h.renderers || !h.getFiberRoots) return JSON.stringify({ error: "sin-hook" });
  function coincide(p) {
    if (!p) return false;
    var c = p.children;
    var texto = typeof c === "string" ? c : Array.isArray(c) && c.every(function (x) { return typeof x === "string" || typeof x === "number"; }) ? c.join("") : null;
    var candidatos = [texto, p.placeholder, p.accessibilityLabel, p["aria-label"], p.testID, p.nativeID, p.value, p.title];
    for (var i = 0; i < candidatos.length; i++) {
      var v = candidatos[i];
      if (typeof v === "string" && v.trim() && buscados.indexOf(v.trim()) >= 0) return true;
    }
    return false;
  }
  var mejor = null;
  h.renderers.forEach(function (_r, id) {
    var raices = h.getFiberRoots(id);
    if (!raices) return;
    raices.forEach(function (raiz) {
      var pila = [raiz.current], vueltas = 0;
      while (pila.length && vueltas < 300000 && !mejor) {
        var f = pila.pop(); vueltas++;
        if (coincide(f.memoizedProps)) {
          var cadena = [], g = f;
          while (g && cadena.length < 40) {
            var t = g.type;
            var nombre = t && typeof t !== "string" ? (t.displayName || t.name || (t.render && (t.render.displayName || t.render.name))) : null;
            if (nombre && cadena.indexOf(nombre) < 0) cadena.push(nombre);
            g = g.return;
          }
          mejor = cadena;
        }
        if (f.sibling) pila.push(f.sibling);
        if (f.child) pila.push(f.child);
      }
    });
  });
  return JSON.stringify({ cadena: mejor });
})(${JSON.stringify(buscados)})`;
}

export async function componentesEnPantalla(metro: number, buscados: string[]): Promise<ComponentesEnPantalla | null> {
  const utiles = [...new Set(buscados.map((b) => b.trim()).filter((b) => b && b.length <= 300))].slice(0, 12);
  if (utiles.length === 0) return null;
  const lista = (await (await fetch(`http://127.0.0.1:${metro}/json/list`, { signal: AbortSignal.timeout(CORTE_MS) })).json()) as Array<{
    webSocketDebuggerUrl?: string;
    description?: string;
  }>;
  const pagina = lista.find((p) => p.webSocketDebuggerUrl);
  if (!pagina?.webSocketDebuggerUrl) return null;
  const ws = await abrirWebSocket(pagina.webSocketDebuggerUrl, `http://127.0.0.1:${metro}`);
  try {
    const respuesta = await new Promise<string>((resolver, rechazar) => {
      const corte = setTimeout(() => rechazar(new Error("El depurador no contestó.")), CORTE_MS);
      ws.alRecibir((texto) => {
        const d = JSON.parse(texto) as { id?: number; result?: { result?: { value?: string } } };
        if (d.id === 1) {
          clearTimeout(corte);
          resolver(d.result?.result?.value ?? "{}");
        }
      });
      ws.enviar(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: expresion(utiles), returnByValue: true } }));
    });
    const { cadena } = JSON.parse(respuesta) as { cadena?: string[] | null };
    return cadena ? limpiarCadena(cadena) : null;
  } finally {
    ws.cerrar();
  }
}

// --- La consola de JavaScript de la app ---------------------------------------------

export interface EntradaDeConsola {
  at: number;
  /** log, info, warn, error, debug… o "excepcion" para un error sin capturar. */
  nivel: string;
  texto: string;
}

const MAX_ENTRADAS = 1_000;

/**
 * Lo que la app escribe con `console.*` y sus excepciones sin capturar, leído
 * del depurador de Hermes por el Metro de la sesión (`Runtime.enable`).
 *
 * Existe porque en React Native con la arquitectura nueva, en desarrollo, el
 * `console.log` de JavaScript **no pasa por logcat** (se buscó la etiqueta
 * `ReactNativeJS` en el teléfono y no hay nada) ni por la terminal de Metro: va
 * al depurador. Sin esto, un agente que depura "en el celular no anda" no ve el
 * error de JavaScript, que es casi siempre la causa.
 *
 * Una por puerto de Metro, viva mientras alguien la consulte en los últimos
 * diez minutos: se reconecta sola cuando la app se reinicia (cambia la página
 * del depurador) y deja de intentarlo cuando nadie mira.
 */
export class ConsolaJs {
  private entradas: EntradaDeConsola[] = [];
  private conexion: Conexion | null = null;
  private conectando = false;
  private ultimaConsulta = 0;
  private timer: NodeJS.Timeout | null = null;
  estado: "desconectada" | "conectada" = "desconectada";

  constructor(private readonly metro: number) {}

  /** Lo capturado, y de paso la mantiene viva. */
  leer(): EntradaDeConsola[] {
    this.ultimaConsulta = Date.now();
    void this.asegurar();
    return this.entradas;
  }

  private async asegurar(): Promise<void> {
    if (this.conexion || this.conectando) return;
    this.conectando = true;
    try {
      const lista = (await (await fetch(`http://127.0.0.1:${this.metro}/json/list`, { signal: AbortSignal.timeout(CORTE_MS) })).json()) as Array<{
        webSocketDebuggerUrl?: string;
      }>;
      const pagina = lista.find((p) => p.webSocketDebuggerUrl);
      if (!pagina?.webSocketDebuggerUrl) throw new Error("La app no está conectada al Metro.");
      const ws = await abrirWebSocket(pagina.webSocketDebuggerUrl, `http://127.0.0.1:${this.metro}`);
      this.conexion = ws;
      this.estado = "conectada";
      ws.alRecibir((texto) => this.recibir(texto));
      ws.alCerrar(() => {
        this.conexion = null;
        this.estado = "desconectada";
        this.reintentar();
      });
      ws.enviar(JSON.stringify({ id: 1, method: "Runtime.enable" }));
    } catch {
      this.reintentar();
    } finally {
      this.conectando = false;
    }
  }

  private reintentar(): void {
    if (this.timer || Date.now() - this.ultimaConsulta > 10 * 60_000) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.asegurar();
    }, 5_000);
    this.timer.unref?.();
  }

  /** Un mensaje del depurador (público para fijarlo con tests). */
  recibir(texto: string): void {
    let d: { method?: string; params?: Record<string, unknown> };
    try {
      d = JSON.parse(texto) as typeof d;
    } catch {
      return;
    }
    if (d.method === "Runtime.consoleAPICalled") {
      const p = d.params as { type?: string; args?: Array<{ value?: unknown; description?: string; type?: string }>; stackTrace?: { callFrames?: Array<{ functionName?: string; lineNumber?: number }> } };
      const partes = (p.args ?? []).map((a) => (typeof a.value === "string" ? a.value : a.value !== undefined ? JSON.stringify(a.value) : (a.description ?? a.type ?? "")));
      const donde = p.stackTrace?.callFrames?.[0]?.functionName;
      this.guardar(p.type ?? "log", `${partes.join(" ")}${donde && (p.type === "error" || p.type === "warn") ? `  (en ${donde})` : ""}`);
    } else if (d.method === "Runtime.exceptionThrown") {
      const e = (d.params as { exceptionDetails?: { text?: string; exception?: { description?: string } } }).exceptionDetails;
      this.guardar("excepcion", e?.exception?.description ?? e?.text ?? "Excepción sin detalle");
    }
  }

  private guardar(nivel: string, texto: string): void {
    this.entradas.push({ at: Date.now(), nivel, texto: texto.slice(0, 8_000) });
    if (this.entradas.length > MAX_ENTRADAS) this.entradas = this.entradas.slice(-MAX_ENTRADAS);
  }
}

const consolas = new Map<number, ConsolaJs>();
export function consolaJs(metro: number): ConsolaJs {
  let c = consolas.get(metro);
  if (!c) {
    c = new ConsolaJs(metro);
    consolas.set(metro, c);
  }
  return c;
}
