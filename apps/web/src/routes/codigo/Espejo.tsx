import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Circle, Loader2, MousePointerClick, Play, Smartphone, Square } from "lucide-react";
import { api, type NodoDePantalla, type ServicioConEstado } from "../../api.js";
import type { ElementoSeleccionado } from "./elemento.js";
import { PanelDeCelular } from "./Celular.js";

/**
 * El teléfono de la persona en vivo, adentro del IDE: se ve la pantalla real
 * (`screenrecord` → MJPEG, ver `dispositivos.ts`), se toca con el mouse, se
 * desliza arrastrando, la rueda hace scroll y el teclado escribe en el campo
 * con foco.
 *
 * **Seleccionar** es el mismo gesto que en la vista web, sobre otra fuente: el
 * árbol de accesibilidad de Android (`uiautomator`) dice qué hay y dónde —se
 * lee una vez al entrar en el modo, y el resaltado se calcula acá—, y al
 * elegir se le pregunta a la app por el depurador de Metro qué componentes de
 * React lo dibujan (`inspector-rn.ts`). Lo que llega al chat tiene la misma
 * forma que un elemento de la web, así que la búsqueda de archivos candidatos
 * es la misma.
 */

interface Punto {
  x: number;
  y: number;
}

/** Un toque que se movió menos que esto es un toque, no un deslizamiento. */
const UMBRAL_DESLIZAR = 0.015;

export function Espejo({
  repoId,
  s,
  onElemento,
}: {
  repoId: string;
  s: ServicioConEstado;
  onElemento?: (elemento: ElementoSeleccionado) => void;
}) {
  const lista = useQuery({ queryKey: ["dispositivos"], queryFn: api.dispositivos, refetchInterval: 5_000 });
  const listos = (lista.data?.dispositivos ?? []).filter((d) => d.estado === "device");
  const [elegido, setElegido] = useState<string | null>(null);
  const serial = elegido && listos.some((d) => d.serial === elegido) ? elegido : (listos[0]?.serial ?? null);
  const telefono = listos.find((d) => d.serial === serial) ?? null;
  // scrcpy + WebCodecs: video H.264 decodificado por hardware y toques en vivo.
  // Sin alguno de los dos, el espejo de respaldo (screenrecord → JPEG).
  const h264 = useSoporteH264();
  const [sinDecodificador, setSinDecodificador] = useState(false);
  const enVivo = lista.data?.espejo?.motor === "scrcpy" && h264 === true && !sinDecodificador;
  const [panel, setPanel] = useState(false);

  const abrir = useMutation({ mutationFn: () => api.abrirEnDispositivo(repoId, s.id, serial!) });

  return (
    <div className="flex min-h-0 flex-1">
      <div className="@container flex min-h-0 min-w-0 flex-1 flex-col">
        {serial && telefono ? (
          <>
            <BarraDelTelefono
              serial={serial}
              modelo={telefono.modelo ?? serial}
              otros={listos.length > 1 ? listos.map((d) => ({ serial: d.serial, nombre: d.modelo ?? d.serial })) : []}
              onElegir={setElegido}
              abriendo={abrir.isPending}
              onAbrir={() => abrir.mutate()}
              panel={panel}
              onPanel={() => setPanel((v) => !v)}
            />
            {abrir.error && <p className="border-b border-line bg-danger/10 px-3 py-1 text-[12px] text-danger">{(abrir.error as Error).message}</p>}
            {h264 === null || !lista.data ? (
              <div className="flex flex-1 items-center justify-center text-ink-faint">
                <Loader2 className="size-5 animate-spin" aria-hidden />
              </div>
            ) : (
            <Pantalla
              key={`${serial}:${enVivo ? "scrcpy" : "mjpeg"}`}
              repoId={repoId}
              servicioId={s.id}
              serial={serial}
              enVivo={enVivo}
              onSinDecodificador={() => setSinDecodificador(true)}
              onPerdido={() => void lista.refetch()}
              {...(onElemento ? { onElemento } : {})}
            />
            )}
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-[13px] text-ink-faint">
            <Smartphone className="size-10" aria-hidden />
            {lista.isLoading ? "Buscando teléfonos…" : "No hay un teléfono conectado. Vinculalo por QR desde el panel de la derecha."}
          </div>
        )}
      </div>
      {(panel || !serial) && <PanelDeCelular repoId={repoId} servicioId={s.id} onCerrar={() => setPanel(false)} />}
    </div>
  );
}

function BarraDelTelefono({
  serial,
  modelo,
  otros,
  onElegir,
  abriendo,
  onAbrir,
  panel,
  onPanel,
}: {
  serial: string;
  modelo: string;
  otros: Array<{ serial: string; nombre: string }>;
  onElegir: (serial: string) => void;
  abriendo: boolean;
  onAbrir: () => void;
  panel: boolean;
  onPanel: () => void;
}) {
  const tecla = (t: "atras" | "inicio" | "recientes") => void api.teclaDispositivo(serial, t).catch(() => {});
  const boton = "rounded p-1 text-ink-dim hover:bg-surface-2 hover:text-ink";
  return (
    <div className="flex h-9 shrink-0 items-center gap-1.5 overflow-hidden whitespace-nowrap border-b border-line bg-surface px-2 text-[12px]">
      <Smartphone className="size-3.5 shrink-0 text-ok" aria-hidden />
      {otros.length > 0 ? (
        <select value={serial} onChange={(e) => onElegir(e.target.value)} className="rounded border border-line bg-canvas px-1 py-0.5 text-ink">
          {otros.map((o) => (
            <option key={o.serial} value={o.serial}>
              {o.nombre}
            </option>
          ))}
        </select>
      ) : (
        <span className="min-w-0 truncate text-ink">{modelo}</span>
      )}
      <span className="flex shrink-0 items-center gap-0.5 border-l border-line pl-1.5">
        <button type="button" title="Atrás" onClick={() => tecla("atras")} className={boton}>
          <ArrowLeft className="size-3.5" aria-hidden />
        </button>
        <button type="button" title="Inicio" onClick={() => tecla("inicio")} className={boton}>
          <Circle className="size-3.5" aria-hidden />
        </button>
        <button type="button" title="Apps recientes" onClick={() => tecla("recientes")} className={boton}>
          <Square className="size-3.5" aria-hidden />
        </button>
      </span>
      <span className="flex-1" />
      <button
        type="button"
        title="Reabre la app apuntando al Metro de la sesión"
        disabled={abriendo}
        onClick={onAbrir}
        className="flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-ink-dim hover:bg-surface-2 hover:text-ink disabled:opacity-50"
      >
        {abriendo ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
        <span className="hidden @[520px]:inline">Abrir la app</span>
      </button>
      <button
        type="button"
        title="Vincular otro teléfono, instalar la build de desarrollo"
        onClick={onPanel}
        className={`shrink-0 rounded px-1.5 py-1 ${panel ? "bg-surface-2 text-ink" : "text-ink-dim hover:bg-surface-2 hover:text-ink"}`}
      >
        Dispositivos
      </button>
    </div>
  );
}

function Pantalla({
  repoId,
  servicioId,
  serial,
  enVivo,
  onElemento,
  onPerdido,
  onSinDecodificador,
}: {
  repoId: string;
  servicioId: string;
  serial: string;
  /** `true` = scrcpy (canvas + toques en vivo); `false` = respaldo MJPEG. */
  enVivo: boolean;
  onElemento?: (elemento: ElementoSeleccionado) => void;
  /** El stream se cortó: puede que el teléfono volvió con otro puerto (otro serial). */
  onPerdido: () => void;
  /** El navegador no pudo decodificar el H.264 del teléfono: se pasa al respaldo. */
  onSinDecodificador: () => void;
}) {
  /** Donde se dibuja la pantalla (el canvas del video o la imagen del respaldo). */
  const superficie = useRef<HTMLElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [proporcion, setProporcion] = useState<number>(9 / 19.5);
  const respaldo = usePantallaEnVivo(enVivo ? null : serial, onPerdido);
  const video = useVideoScrcpy(enVivo ? serial : null, canvas, onPerdido, setProporcion, onSinDecodificador);
  const src = respaldo.src;
  const conexion = enVivo ? video.conexion : respaldo.conexion;
  const cargada = enVivo ? video.conexion !== "conectando" : src != null;
  const inicio = useRef<{ p: Punto; t: number } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  /** Una marca donde se tocó: el teléfono tarda un momento en mostrar el cambio, y sin ella el clic parece perdido. */
  const [marcas, setMarcas] = useState<Array<{ id: number; x: number; y: number }>>([]);
  const marcar = (p: Punto) => {
    const id = performance.now();
    setMarcas((m) => [...m.slice(-4), { id, ...p }]);
    setTimeout(() => setMarcas((m) => m.filter((x) => x.id !== id)), 450);
  };

  // Selección
  const [seleccionando, setSeleccionando] = useState(false);
  const [arbol, setArbol] = useState<{ ancho: number; alto: number; nodos: NodoDePantalla[] } | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [sobre, setSobre] = useState<NodoDePantalla | null>(null);
  const [enviando, setEnviando] = useState(false);

  const relativo = (e: { clientX: number; clientY: number }): Punto | null => {
    const r = superficie.current?.getBoundingClientRect();
    if (!r || r.width === 0) return null;
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    return x < 0 || x > 1 || y < 0 || y > 1 ? null : { x, y };
  };

  const nodoEn = (p: Punto): NodoDePantalla | null => {
    if (!arbol) return null;
    const debajo = arbol.nodos.filter((n) => p.x >= n.x && p.x <= n.x + n.ancho && p.y >= n.y && p.y <= n.y + n.alto);
    // El más chico que contiene el punto: es el que la persona está mirando.
    debajo.sort((a, b) => a.ancho * a.alto - b.ancho * b.alto);
    return debajo[0] ?? null;
  };

  const activarSeleccion = async () => {
    if (seleccionando) {
      setSeleccionando(false);
      setSobre(null);
      return;
    }
    setSeleccionando(true);
    setLeyendo(true);
    setAviso(null);
    try {
      setArbol(await api.arbolDeDispositivo(serial));
    } catch (error) {
      setAviso((error as Error).message);
      setSeleccionando(false);
    } finally {
      setLeyendo(false);
    }
  };

  useEffect(() => {
    if (!seleccionando) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSeleccionando(false);
        setSobre(null);
      }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [seleccionando]);

  const elegir = async (nodo: NodoDePantalla) => {
    if (!arbol || !onElemento) return;
    setEnviando(true);
    try {
      const subarbol = descendientes(arbol.nodos, nodo);
      const textos = [...new Set([nodo.texto, nodo.descripcion, nodo.recurso, ...subarbol.flatMap((n) => [n.texto, n.descripcion, n.recurso])].filter(Boolean))];
      const r = await api.componentesEnDispositivo(repoId, servicioId, textos).catch(() => ({ componentes: [], pantallas: [] as string[] }));
      const atributos: Record<string, string> = {};
      if (nodo.descripcion) atributos.accessibilityLabel = nodo.descripcion;
      if (nodo.recurso) atributos.testID = nodo.recurso;
      if (nodo.pulsable) atributos.pulsable = "sí";
      onElemento({
        etiqueta: nodo.clase || "View",
        selector: `${nodo.clase}${nodo.descripcion ? `[accessibilityLabel="${nodo.descripcion}"]` : nodo.texto ? `[texto="${nodo.texto}"]` : ""}`,
        texto: textos.filter((t) => t !== nodo.recurso).join(" · ").slice(0, 400),
        html: comoXml(arbol.nodos, nodo, arbol.ancho, arbol.alto),
        componentes: r.componentes,
        fuentes: [],
        atributos,
        ruta: r.pantallas[0] ? `pantalla ${r.pantallas[0]} (app nativa)` : "(app nativa)",
        titulo: "",
        tamano: `${Math.round(nodo.ancho * arbol.ancho)}x${Math.round(nodo.alto * arbol.alto)}`,
      });
      setSeleccionando(false);
      setSobre(null);
    } finally {
      setEnviando(false);
    }
  };

  // --- Toques, deslizamientos, rueda y teclado ---------------------------------

  const alBajar = (e: React.PointerEvent) => {
    const p = relativo(e);
    if (!p) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    inicio.current = { p, t: performance.now() };
    if (enVivo && !seleccionando) {
      marcar(p);
      video.enviar({ t: "toque", a: "abajo", x: p.x, y: p.y });
    }
  };
  const alMover = (e: React.PointerEvent) => {
    const p = relativo(e);
    if (seleccionando) {
      setSobre(p ? nodoEn(p) : null);
      return;
    }
    // En vivo, el dedo sigue al mouse mientras está apretado: la lista se
    // mueve mientras se arrastra, no al soltar.
    if (enVivo && inicio.current && p) video.enviar({ t: "toque", a: "mover", x: p.x, y: p.y });
  };
  const alSubir = (e: React.PointerEvent) => {
    const desde = inicio.current;
    inicio.current = null;
    const hasta = relativo(e) ?? (desde ? desde.p : null);
    if (!desde || !hasta) return;
    if (seleccionando) {
      const n = nodoEn(hasta);
      if (n) void elegir(n);
      return;
    }
    if (enVivo) {
      video.enviar({ t: "toque", a: "arriba", x: Math.min(1, Math.max(0, hasta.x)), y: Math.min(1, Math.max(0, hasta.y)) });
      return;
    }
    const distancia = Math.hypot(hasta.x - desde.p.x, hasta.y - desde.p.y);
    marcar(hasta);
    const llamada =
      distancia < UMBRAL_DESLIZAR
        ? api.tocarDispositivo(serial, hasta.x, hasta.y)
        : api.deslizarDispositivo(serial, desde.p, hasta, performance.now() - desde.t);
    llamada.catch((error: Error) => setAviso(error.message));
  };

  const rueda = useRef({ acumulado: 0, h: 0, timer: null as ReturnType<typeof setTimeout> | null, punto: { x: 0.5, y: 0.5 }, cuadro: 0 });
  const alRodar = (e: React.WheelEvent) => {
    const p = relativo(e);
    if (!p || seleccionando) return;
    const r = rueda.current;
    r.punto = p;
    if (enVivo) {
      // La rueda de verdad: un evento de scroll nativo en el punto del mouse,
      // agrupado por cuadro de animación. Un "clic" de rueda (≈100 px) es 1.
      r.acumulado += e.deltaY;
      r.h += e.deltaX;
      if (r.cuadro) return;
      r.cuadro = requestAnimationFrame(() => {
        const v = Math.max(-16, Math.min(16, -r.acumulado / 100));
        const h = Math.max(-16, Math.min(16, -r.h / 100));
        r.acumulado = 0;
        r.h = 0;
        r.cuadro = 0;
        video.enviar({ t: "rueda", x: r.punto.x, y: r.punto.y, h, v });
      });
      return;
    }
    r.acumulado += e.deltaY;
    if (r.timer) clearTimeout(r.timer);
    r.timer = setTimeout(() => {
      const alto = superficie.current?.getBoundingClientRect().height ?? 800;
      const delta = Math.max(-0.6, Math.min(0.6, r.acumulado / alto));
      r.acumulado = 0;
      const y0 = Math.min(0.9, Math.max(0.1, r.punto.y));
      const y1 = Math.min(0.95, Math.max(0.05, y0 - delta));
      void api.deslizarDispositivo(serial, { x: r.punto.x, y: y0 }, { x: r.punto.x, y: y1 }, 250).catch(() => {});
    }, 120);
  };

  const texto = useRef({ buffer: "", timer: null as ReturnType<typeof setTimeout> | null });
  const alTeclear = (e: React.KeyboardEvent) => {
    if (seleccionando || e.metaKey || e.ctrlKey) return;
    const vaciar = () => {
      const t = texto.current;
      if (t.timer) clearTimeout(t.timer);
      t.timer = null;
      if (!t.buffer) return Promise.resolve();
      const enviar = t.buffer;
      t.buffer = "";
      if (enVivo) {
        video.enviar({ t: "texto", s: enviar.slice(0, 300) });
        return Promise.resolve();
      }
      return api
        .textoDispositivo(serial, enviar)
        .then((r) => {
          if (r.omitidos)
            setAviso(
              enVivo
                ? "El texto era muy largo: se mandaron los primeros 300 bytes."
                : "Sin scrcpy el teléfono sólo recibe texto sin tildes ni eñes por adb: esas letras se omitieron.",
            );
        })
        .catch(() => {});
    };
    if (e.key === "Enter" || e.key === "Backspace") {
      e.preventDefault();
      const t = e.key === "Enter" ? "enter" : "borrar";
      void vaciar().then(() => (enVivo ? video.enviar({ t: "tecla", k: t }) : api.teclaDispositivo(serial, t).catch(() => {})));
      return;
    }
    if (e.key.length === 1) {
      e.preventDefault();
      texto.current.buffer += e.key;
      if (texto.current.timer) clearTimeout(texto.current.timer);
      texto.current.timer = setTimeout(() => void vaciar(), enVivo ? 30 : 250);
    }
  };

  const marco = sobre && (
    <div
      className="pointer-events-none absolute rounded-sm border-2 border-accent bg-accent/15"
      style={{ left: `${sobre.x * 100}%`, top: `${sobre.y * 100}%`, width: `${sobre.ancho * 100}%`, height: `${sobre.alto * 100}%` }}
    >
      <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-accent px-1 font-mono text-[10px] text-white">
        {sobre.clase}
        {sobre.descripcion ? ` · ${sobre.descripcion.slice(0, 30)}` : sobre.texto ? ` · ${sobre.texto.slice(0, 30)}` : ""}
      </span>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-canvas px-2 text-[12px]">
        {onElemento && (
          <button
            type="button"
            onClick={() => void activarSeleccion()}
            title="Señalar una parte de la app para pedirle un cambio al chat (Esc cancela)"
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 ${
              seleccionando ? "bg-accent text-white" : "text-ink-dim hover:bg-surface-2 hover:text-ink"
            }`}
          >
            {leyendo || enviando ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <MousePointerClick className="size-3.5" aria-hidden />}
            {leyendo ? "Leyendo la pantalla…" : enviando ? "Buscando el componente…" : seleccionando ? "Elegí un elemento…" : "Seleccionar"}
          </button>
        )}
        <span className="truncate text-ink-faint">
          {seleccionando
            ? "Pasá el mouse por la pantalla y hacé clic en lo que querés cambiar."
            : "Clic = tocar · arrastrar = deslizar · rueda = scroll · teclado = escribir en el campo con foco"}
        </span>
        {aviso && (
          <button type="button" onClick={() => setAviso(null)} className="ml-auto truncate text-danger" title="Cerrar">
            {aviso}
          </button>
        )}
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-surface-2 p-4">
        <div
          className="relative h-full max-h-full"
          style={{ aspectRatio: String(proporcion) }}
          tabIndex={0}
          onKeyDown={alTeclear}
        >
          {enVivo ? (
            <canvas
              ref={(el) => {
                canvas.current = el;
                superficie.current = el;
              }}
              aria-label="Pantalla del teléfono en vivo"
              onPointerDown={alBajar}
              onPointerMove={alMover}
              onPointerUp={alSubir}
              onPointerCancel={alSubir}
              onPointerLeave={() => setSobre(null)}
              onWheel={alRodar}
              className={`h-full w-full touch-none select-none rounded-[22px] bg-black shadow-xl ring-8 ring-ink/80 ${
                seleccionando ? "cursor-crosshair" : "cursor-pointer"
              }`}
            />
          ) : (
            <img
              ref={(el) => {
                superficie.current = el;
              }}
              {...(src ? { src } : {})}
              alt="Pantalla del teléfono en vivo"
              draggable={false}
              onLoad={(e) => {
                const i = e.currentTarget;
                if (i.naturalWidth && i.naturalHeight) setProporcion(i.naturalWidth / i.naturalHeight);
              }}
              onPointerDown={alBajar}
              onPointerMove={alMover}
              onPointerUp={alSubir}
              onPointerLeave={() => setSobre(null)}
              onWheel={alRodar}
              className={`h-full w-full select-none rounded-[22px] bg-black object-contain shadow-xl ring-8 ring-ink/80 ${
                seleccionando ? "cursor-crosshair" : "cursor-pointer"
              }`}
            />
          )}
          {marco}
          {marcas.map((m) => (
            <span
              key={m.id}
              className="pointer-events-none absolute size-7 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full bg-accent/60"
              style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }}
            />
          ))}
          {(!cargada || conexion === "reconectando") && (
            <div
              className={`pointer-events-none absolute inset-0 flex items-center justify-center rounded-[22px] text-center text-[12px] text-white ${
                cargada ? "bg-black/55" : ""
              }`}
            >
              <Loader2 className="mr-1.5 size-4 shrink-0 animate-spin" aria-hidden />
              {enVivo && video.error
                ? `${video.error} Reintentando…`
                : conexion === "reconectando"
                  ? "Se cortó la conexión con el teléfono: reconectando…"
                  : "Conectando con la pantalla…"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * La pantalla en vivo leída con `fetch` y no con un `<img>` apuntado al
 * multipart: cuando el stream se corta (el teléfono se bloqueó, la depuración
 * inalámbrica volvió en otro puerto) un `<img>` se queda con el último cuadro y
 * no avisa nada —la vista parecía viva y estaba congelada—. Acá se sabe cuándo
 * llega cada cuadro y cuándo termina el stream, y se reconecta solo.
 */
function usePantallaEnVivo(serial: string | null, onPerdido: () => void) {
  const [src, setSrc] = useState<string | null>(null);
  const [conexion, setConexion] = useState<"conectando" | "viva" | "reconectando">("conectando");
  const perdido = useRef(onPerdido);
  perdido.current = onPerdido;

  useEffect(() => {
    if (!serial) return;
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let actual: string | null = null;
    const mostrar = (jpeg: Uint8Array) => {
      const url = URL.createObjectURL(new Blob([jpeg as BlobPart], { type: "image/jpeg" }));
      const anterior = actual;
      actual = url;
      setSrc(url);
      setConexion("viva");
      // El anterior se suelta después de que el nuevo ya está puesto.
      if (anterior) setTimeout(() => URL.revokeObjectURL(anterior), 1_000);
    };
    const conectar = async () => {
      try {
        const r = await fetch(api.urlPantalla(serial!), { signal: ctrl.signal });
        if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
        const lector = r.body.getReader();
        let buf = new Uint8Array(0);
        for (;;) {
          const { value, done } = await lector.read();
          if (done) break;
          const junto = new Uint8Array(buf.length + value.length);
          junto.set(buf);
          junto.set(value, buf.length);
          buf = junto;
          // Se muestra sólo el último cuadro completo de lo que llegó.
          let ultimo: Uint8Array | null = null;
          for (;;) {
            const inicio = indice(buf, 0xff, 0xd8, 0);
            if (inicio < 0) {
              buf = new Uint8Array(0);
              break;
            }
            const fin = indice(buf, 0xff, 0xd9, inicio + 2);
            if (fin < 0) {
              buf = buf.slice(inicio);
              break;
            }
            ultimo = buf.slice(inicio, fin + 2);
            buf = buf.slice(fin + 2);
          }
          if (ultimo) mostrar(ultimo);
        }
      } catch {
        if (ctrl.signal.aborted) return;
      }
      if (ctrl.signal.aborted) return;
      setConexion("reconectando");
      perdido.current();
      timer = setTimeout(() => void conectar(), 1_500);
    };
    void conectar();
    return () => {
      ctrl.abort();
      if (timer) clearTimeout(timer);
      if (actual) URL.revokeObjectURL(actual);
    };
  }, [serial]);

  return { src, conexion };
}

/**
 * ¿Este navegador decodifica H.264 con WebCodecs? Chrome sí; un Chromium sin
 * códecs propietarios (el de Playwright) no, y ahí se usa el respaldo MJPEG.
 */
function useSoporteH264(): boolean | null {
  const [soporte, setSoporte] = useState<boolean | null>(null);
  useEffect(() => {
    if (typeof VideoDecoder === "undefined") return setSoporte(false);
    VideoDecoder.isConfigSupported({ codec: "avc1.640028" })
      .then((r) => setSoporte(r.supported === true))
      .catch(() => setSoporte(false));
  }, []);
  return soporte;
}

/** Lo que el navegador le manda al teléfono por el WebSocket del espejo. */
type MensajeAlTelefono =
  | { t: "toque"; a: "abajo" | "mover" | "arriba"; x: number; y: number }
  | { t: "rueda"; x: number; y: number; h: number; v: number }
  | { t: "tecla"; k: "atras" | "inicio" | "recientes" | "enter" | "borrar" | "menu" }
  | { t: "texto"; s: string };

/**
 * El espejo con scrcpy por **un WebSocket**: bajan los paquetes H.264 (uno por
 * mensaje) y suben los toques, en orden. Con un pedido HTTP por toque, el
 * proxy de Vite metía picos de 60 ms y el arrastre salía a los tirones.
 *
 * El video lo decodifica el navegador (WebCodecs, por hardware) y se dibuja en
 * un canvas. La config (SPS/PPS) va pegada adelante del cuadro clave
 * siguiente, que es como la espera el decodificador en formato Annex B. Si la
 * conexión se corta, se reconecta sola y el servidor manda un cuadro clave.
 */
function useVideoScrcpy(
  serial: string | null,
  canvas: React.RefObject<HTMLCanvasElement | null>,
  onPerdido: () => void,
  alTamano: (proporcion: number) => void,
  onSinDecodificador: () => void,
) {
  const [conexion, setConexion] = useState<"conectando" | "viva" | "reconectando">("conectando");
  const [error, setError] = useState<string | null>(null);
  const sinDecodificador = useRef(onSinDecodificador);
  sinDecodificador.current = onSinDecodificador;
  const estado = useRef(conexion);
  const perdido = useRef(onPerdido);
  perdido.current = onPerdido;
  const tamano = useRef(alTamano);
  tamano.current = alTamano;
  const socket = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!serial) return;
    let vivo = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let decoder: VideoDecoder | null = null;
    let config: Uint8Array | null = null;
    let esperandoClave = true;
    let ts = 0;
    // Sólo se re-renderiza cuando cambia el estado, no en cada cuadro.
    const marcar = (e: "conectando" | "viva" | "reconectando") => {
      if (estado.current === e) return;
      estado.current = e;
      setConexion(e);
    };
    const configurar = (datos: Uint8Array) => {
      const codec = codecDeSps(datos);
      if (!codec) return;
      if (!decoder || decoder.state === "closed") {
        decoder = new VideoDecoder({
          output: (cuadro) => {
            const c = canvas.current;
            if (c) {
              if (c.width !== cuadro.displayWidth || c.height !== cuadro.displayHeight) {
                c.width = cuadro.displayWidth;
                c.height = cuadro.displayHeight;
              }
              c.getContext("2d")?.drawImage(cuadro, 0, 0);
            }
            cuadro.close();
            marcar("viva");
          },
          // Un error deja el decodificador cerrado: se rearma con la próxima config.
          error: () => {
            esperandoClave = true;
          },
        });
      }
      try {
        decoder.configure({ codec, optimizeForLatency: true, hardwareAcceleration: "prefer-hardware" });
      } catch {
        // Un Chromium sin H.264 (el de Playwright, por ejemplo): al respaldo.
        sinDecodificador.current();
        return;
      }
      config = datos;
      esperandoClave = true;
    };
    const paquete = (buf: ArrayBuffer) => {
      const vista = new DataView(buf);
      if (buf.byteLength < 5) return;
      const tipo = vista.getUint8(0);
      const datos = new Uint8Array(buf, 5, Math.min(vista.getUint32(1), buf.byteLength - 5));
      if (tipo === 0) {
        const ancho = vista.getUint32(5);
        const alto = vista.getUint32(9);
        if (ancho && alto) tamano.current(ancho / alto);
      } else if (tipo === 1) {
        configurar(datos.slice());
      } else if (decoder && decoder.state === "configured") {
        if (tipo === 2) {
          const pegado = new Uint8Array((config?.length ?? 0) + datos.length);
          if (config) pegado.set(config);
          pegado.set(datos, config?.length ?? 0);
          decoder.decode(new EncodedVideoChunk({ type: "key", timestamp: (ts += 16_667), data: pegado }));
          esperandoClave = false;
        } else if (!esperandoClave) {
          decoder.decode(new EncodedVideoChunk({ type: "delta", timestamp: (ts += 16_667), data: datos }));
        }
      }
    };
    const conectar = () => {
      const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/dispositivos/${encodeURIComponent(serial)}/espejo`;
      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      socket.current = ws;
      ws.onmessage = (e) => {
        if (typeof e.data === "string") {
          try {
            setError((JSON.parse(e.data) as { error?: string }).error ?? null);
          } catch {
            // un mensaje de texto que no es JSON: se ignora
          }
          return;
        }
        setError(null);
        paquete(e.data as ArrayBuffer);
      };
      ws.onclose = () => {
        if (socket.current === ws) socket.current = null;
        if (!vivo) return;
        marcar("reconectando");
        esperandoClave = true;
        perdido.current();
        timer = setTimeout(conectar, 1_000);
      };
    };
    conectar();
    return () => {
      vivo = false;
      if (timer) clearTimeout(timer);
      socket.current?.close();
      socket.current = null;
      if (decoder && decoder.state !== "closed") decoder.close();
    };
  }, [serial, canvas]);

  const enviar = (m: MensajeAlTelefono) => {
    const ws = socket.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  };
  return { conexion, error, enviar };
}

/** `avc1.PPCCLL` a partir del SPS (NAL tipo 7) de la config en Annex B. */
function codecDeSps(datos: Uint8Array): string | null {
  for (let i = 0; i + 4 < datos.length; i++) {
    const inicio = datos[i] === 0 && datos[i + 1] === 0 && (datos[i + 2] === 1 || (datos[i + 2] === 0 && datos[i + 3] === 1));
    if (!inicio) continue;
    const nal = datos[i + 2] === 1 ? i + 3 : i + 4;
    if ((datos[nal]! & 0x1f) === 7 && nal + 3 < datos.length) {
      const hex = (n: number) => n.toString(16).padStart(2, "0").toUpperCase();
      return `avc1.${hex(datos[nal + 1]!)}${hex(datos[nal + 2]!)}${hex(datos[nal + 3]!)}`;
    }
  }
  return null;
}

function indice(buf: Uint8Array, a: number, b: number, desde: number): number {
  for (let i = desde; i + 1 < buf.length; i++) if (buf[i] === a && buf[i + 1] === b) return i;
  return -1;
}

function descendientes(nodos: NodoDePantalla[], raiz: NodoDePantalla): NodoDePantalla[] {
  const hijos = new Map<number, NodoDePantalla[]>();
  for (const n of nodos) if (n.padre != null) hijos.set(n.padre, [...(hijos.get(n.padre) ?? []), n]);
  const salida: NodoDePantalla[] = [];
  const pila = [...(hijos.get(raiz.id) ?? [])];
  while (pila.length && salida.length < 40) {
    const n = pila.shift()!;
    salida.push(n);
    pila.push(...(hijos.get(n.id) ?? []));
  }
  return salida;
}

/** El nodo y lo que tiene adentro, como lo mostraría un inspector de Android. */
function comoXml(nodos: NodoDePantalla[], raiz: NodoDePantalla, ancho: number, alto: number): string {
  const hijos = new Map<number, NodoDePantalla[]>();
  for (const n of nodos) if (n.padre != null) hijos.set(n.padre, [...(hijos.get(n.padre) ?? []), n]);
  const attr = (n: NodoDePantalla) =>
    [
      n.texto && `text="${n.texto}"`,
      n.descripcion && `accessibilityLabel="${n.descripcion}"`,
      n.recurso && `testID="${n.recurso}"`,
      n.pulsable && "pulsable",
      `bounds="${Math.round(n.x * ancho)},${Math.round(n.y * alto)} ${Math.round(n.ancho * ancho)}x${Math.round(n.alto * alto)}"`,
    ]
      .filter(Boolean)
      .join(" ");
  const lineas: string[] = [];
  const pintar = (n: NodoDePantalla, nivel: number) => {
    if (lineas.length > 40) return;
    const propios = hijos.get(n.id) ?? [];
    const sangria = "  ".repeat(nivel);
    if (propios.length === 0) lineas.push(`${sangria}<${n.clase} ${attr(n)} />`);
    else {
      lineas.push(`${sangria}<${n.clase} ${attr(n)}>`);
      for (const h of propios) pintar(h, nivel + 1);
      lineas.push(`${sangria}</${n.clase}>`);
    }
  };
  pintar(raiz, 0);
  return lineas.join("\n");
}
