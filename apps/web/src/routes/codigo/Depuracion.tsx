import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronRight, Database, FileText, Folder, Gauge, Info, Loader2, MessageSquarePlus, RotateCw, ScrollText, Trash2 } from "lucide-react";
import { api } from "../../api.js";
import { ConfirmDialog } from "../../ui/index.js";
import type { FallaDeVista } from "./sonda.js";

/**
 * Depurar la app móvil en el teléfono, desde el IDE: logs, estado, archivos,
 * base local y diagnósticos. Son las mismas operaciones que tienen los agentes
 * (`logs_del_telefono`, `archivos_de_la_app`…) sobre las mismas reglas del
 * servidor (`depuracion-movil.ts`): la app del repo y nada más del teléfono.
 */

type Seccion = "logs" | "estado" | "archivos" | "base" | "diagnostico";

export function Depuracion({ repoId, onFalla }: { repoId: string; onFalla?: (falla: FallaDeVista) => void }) {
  const [seccion, setSeccion] = useState<Seccion>("logs");
  const [baseElegida, setBaseElegida] = useState("files/SQLite/inspia.db");
  const [confirmarLimpiar, setConfirmarLimpiar] = useState(false);
  const reiniciar = useMutation({ mutationFn: () => api.reiniciarAppDelTelefono(repoId) });
  const limpiar = useMutation({ mutationFn: () => api.limpiarDatosDelTelefono(repoId) });

  const tab = (s: Seccion, rotulo: string, Icono: typeof ScrollText) => (
    <button
      type="button"
      onClick={() => setSeccion(s)}
      className={`flex items-center gap-1 border-b-2 px-2 py-1.5 ${seccion === s ? "border-accent text-ink" : "border-transparent text-ink-dim hover:text-ink"}`}
    >
      <Icono className="size-3.5" aria-hidden />
      {rotulo}
    </button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col text-[12px]">
      <div className="flex shrink-0 items-center gap-1 border-b border-line bg-surface px-2">
        {tab("logs", "Logs", ScrollText)}
        {tab("estado", "Estado", Info)}
        {tab("archivos", "Archivos", Folder)}
        {tab("base", "Base local", Database)}
        {tab("diagnostico", "Diagnóstico", Gauge)}
        <span className="flex-1" />
        <button
          type="button"
          disabled={reiniciar.isPending}
          onClick={() => reiniciar.mutate()}
          title="Cierra y abre la app con sus túneles al Metro y a la API de la sesión"
          className="flex items-center gap-1 rounded px-1.5 py-1 text-ink-dim hover:bg-surface-2 hover:text-ink disabled:opacity-50"
        >
          {reiniciar.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RotateCw className="size-3.5" aria-hidden />}
          Reiniciar app
        </button>
        <button
          type="button"
          onClick={() => setConfirmarLimpiar(true)}
          title="Borra todos los datos de la app en el teléfono (pm clear)"
          className="flex items-center gap-1 rounded px-1.5 py-1 text-ink-dim hover:bg-danger/10 hover:text-danger"
        >
          <Trash2 className="size-3.5" aria-hidden />
          Limpiar datos
        </button>
      </div>
      {(reiniciar.error || limpiar.error || reiniciar.data || limpiar.data) && (
        <p className={`shrink-0 border-b border-line px-3 py-1 ${reiniciar.error || limpiar.error ? "text-danger" : "text-ok"}`}>
          {((reiniciar.error ?? limpiar.error) as Error | null)?.message ?? (limpiar.data ?? reiniciar.data)?.texto}
        </p>
      )}
      <div className="flex min-h-0 flex-1 flex-col">
        {seccion === "logs" && <Logs repoId={repoId} {...(onFalla ? { onFalla } : {})} />}
        {seccion === "estado" && <Estado repoId={repoId} />}
        {seccion === "archivos" && (
          <Archivos
            repoId={repoId}
            onBase={(ruta) => {
              setBaseElegida(ruta);
              setSeccion("base");
            }}
          />
        )}
        {seccion === "base" && <Base repoId={repoId} archivo={baseElegida} onArchivo={setBaseElegida} />}
        {seccion === "diagnostico" && <Diagnostico repoId={repoId} />}
      </div>
      <ConfirmDialog
        abierto={confirmarLimpiar}
        titulo="¿Borrar todos los datos de la app en el teléfono?"
        detalle="Se va la sesión, la caché, la base local y la cola offline que no se haya sincronizado. La app arranca como recién instalada."
        confirmar="Borrar datos"
        onConfirmar={() => {
          setConfirmarLimpiar(false);
          limpiar.mutate();
        }}
        onCancelar={() => setConfirmarLimpiar(false)}
      />
    </div>
  );
}

const NIVELES = ["V", "D", "I", "W", "E"] as const;

/** `09-25 20:35:01.123  1234  1250 E ReactNativeJS: …` → el nivel. */
function nivelDe(linea: string): string | null {
  return /^\d\d-\d\d \d\d:\d\d:\d\d\.\d+\s+\d+\s+\d+\s+([VDIWEF])\s/.exec(linea)?.[1] ?? null;
}

const COLOR: Record<string, string> = {
  E: "text-danger",
  F: "text-danger font-semibold",
  W: "text-warn",
  I: "text-ink",
  D: "text-ink-dim",
  V: "text-ink-faint",
};

function Logs({ repoId, onFalla }: { repoId: string; onFalla?: (falla: FallaDeVista) => void }) {
  const [alcance, setAlcance] = useState<"app" | "fallas">("app");
  const [nivel, setNivel] = useState<(typeof NIVELES)[number]>("I");
  const [buscar, setBuscar] = useState("");
  const [enVivo, setEnVivo] = useState(true);
  const consulta = useQuery({
    queryKey: ["telefono-logs", repoId, alcance, nivel, buscar],
    queryFn: () => api.logsDelTelefono(repoId, { alcance, nivel, lineas: 400, ...(buscar.trim() ? { buscar: buscar.trim() } : {}) }),
    refetchInterval: enVivo ? 2_000 : false,
    placeholderData: (previo) => previo,
  });
  const lineas = (consulta.data?.texto ?? "").split("\n").filter(Boolean);
  const lista = useRef<HTMLDivElement>(null);
  const pegado = useRef(true);
  useEffect(() => {
    if (lista.current && pegado.current) lista.current.scrollTop = lista.current.scrollHeight;
  }, [consulta.data?.texto]);

  const alChat = (i: number) => {
    if (!onFalla) return;
    const linea = lineas[i]!;
    // La línea con su contexto: un stack de JS ocupa varias líneas seguidas.
    const contexto = lineas.slice(Math.max(0, i - 3), i + 12).join("\n");
    const mensaje = linea.replace(/^.*?\s[VDIWEF]\s+/, "").slice(0, 140);
    onFalla({ titulo: `Log del teléfono: ${mensaje}`, detalle: contexto, pagina: "(app nativa)" });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-2 py-1.5">
        <select value={alcance} onChange={(e) => setAlcance(e.target.value as "app" | "fallas")} className="rounded border border-line bg-canvas px-1 py-0.5 text-ink">
          <option value="app">Toda la app</option>
          <option value="fallas">Sólo fallas (crashes)</option>
        </select>
        <select
          value={nivel}
          onChange={(e) => setNivel(e.target.value as (typeof NIVELES)[number])}
          disabled={alcance === "fallas"}
          className="rounded border border-line bg-canvas px-1 py-0.5 text-ink disabled:opacity-50"
        >
          {NIVELES.map((n) => (
            <option key={n} value={n}>
              {{ V: "Verbose", D: "Debug", I: "Info", W: "Advertencias", E: "Errores" }[n]} y más
            </option>
          ))}
        </select>
        <input
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
          placeholder="Buscar (ej. ReactNativeJS, Error)"
          className="h-6 w-56 min-w-0 rounded border border-line bg-canvas px-2 text-ink outline-none focus:border-accent"
        />
        <label className="flex items-center gap-1 text-ink-dim">
          <input type="checkbox" checked={enVivo} onChange={(e) => setEnVivo(e.target.checked)} />
          En vivo
        </label>
        <span className="flex-1" />
        {consulta.isFetching && <Loader2 className="size-3.5 animate-spin text-ink-faint" aria-hidden />}
        <span className="text-ink-faint">{consulta.data ? `${consulta.data.lineas} líneas · ${consulta.data.paquete}` : ""}</span>
      </div>
      {consulta.error ? (
        <p className="p-3 text-danger">{(consulta.error as Error).message}</p>
      ) : (
        <div
          ref={lista}
          onScroll={(e) => {
            const el = e.currentTarget;
            pegado.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
          className="min-h-0 flex-1 overflow-auto bg-canvas font-mono text-[11px] leading-relaxed"
        >
          {lineas.length === 0 && !consulta.isLoading && <p className="p-3 font-sans text-ink-faint">Sin líneas con ese filtro. Usá la app en el teléfono.</p>}
          {lineas.map((l, i) => {
            const n = nivelDe(l);
            return (
              <div key={i} className={`group flex items-start gap-2 px-2 hover:bg-surface-2 ${COLOR[n ?? "I"] ?? "text-ink"}`}>
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-all">{l}</span>
                {onFalla && (n === "E" || n === "F" || n === "W") && (
                  <button
                    type="button"
                    onClick={() => alChat(i)}
                    title="Mandar esta línea y su contexto al chat de IA"
                    className="hidden shrink-0 items-center gap-1 rounded border border-line bg-surface px-1 font-sans text-[10px] text-ink-dim hover:text-accent group-hover:flex"
                  >
                    <MessageSquarePlus className="size-3" aria-hidden /> Al chat
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Estado({ repoId }: { repoId: string }) {
  const consulta = useQuery({ queryKey: ["telefono-estado", repoId], queryFn: () => api.estadoDeLaApp(repoId), refetchInterval: 5_000 });
  return (
    <div className="min-h-0 flex-1 overflow-auto p-3">
      {consulta.error ? (
        <p className="text-danger">{(consulta.error as Error).message}</p>
      ) : consulta.data ? (
        <pre className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-ink">{consulta.data.texto}</pre>
      ) : (
        <Loader2 className="size-4 animate-spin text-ink-faint" aria-hidden />
      )}
    </div>
  );
}

function Archivos({ repoId, onBase }: { repoId: string; onBase: (ruta: string) => void }) {
  const [ruta, setRuta] = useState(".");
  const [abierto, setAbierto] = useState<string | null>(null);
  const listado = useQuery({ queryKey: ["telefono-archivos", repoId, ruta], queryFn: () => api.archivosDeLaApp(repoId, ruta) });
  const contenido = useQuery({
    queryKey: ["telefono-archivo", repoId, abierto],
    queryFn: () => api.archivosDeLaApp(repoId, abierto!, true),
    enabled: abierto != null,
  });
  const entradas = (listado.data?.texto ?? "")
    .split("\n")
    .map((l) => /^([dl-])[rwxstST-]{9}\S*\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\S+\s+(.+)$/.exec(l.trim()))
    .filter((m): m is RegExpExecArray => m != null && m[3] !== "." && m[3] !== "..")
    .map((m) => ({ carpeta: m[1] === "d", bytes: Number(m[2]), nombre: m[3]!.replace(/ -> .*$/, "") }));
  const unir = (n: string) => (ruta === "." ? n : `${ruta}/${n}`);
  const partes = ruta === "." ? [] : ruta.split("/");

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
      <div className="min-h-0 overflow-auto border-r border-line">
        <div className="flex flex-wrap items-center gap-0.5 border-b border-line px-2 py-1.5 font-mono text-[11px]">
          <button type="button" onClick={() => setRuta(".")} className="text-accent hover:underline">
            app
          </button>
          {partes.map((p, i) => (
            <span key={i} className="flex items-center gap-0.5">
              <ChevronRight className="size-3 text-ink-faint" aria-hidden />
              <button type="button" onClick={() => setRuta(partes.slice(0, i + 1).join("/"))} className="text-accent hover:underline">
                {p}
              </button>
            </span>
          ))}
        </div>
        {listado.error ? (
          <p className="p-2 text-danger">{(listado.error as Error).message}</p>
        ) : (
          entradas.map((e) => (
            <button
              key={e.nombre}
              type="button"
              onClick={() => (e.carpeta ? setRuta(unir(e.nombre)) : setAbierto(unir(e.nombre)))}
              className={`flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-surface-2 ${abierto === unir(e.nombre) ? "bg-surface-2" : ""}`}
            >
              {e.carpeta ? <Folder className="size-3.5 shrink-0 text-accent" aria-hidden /> : <FileText className="size-3.5 shrink-0 text-ink-faint" aria-hidden />}
              <span className="min-w-0 flex-1 truncate text-ink">{e.nombre}</span>
              {!e.carpeta && <span className="shrink-0 text-[10px] text-ink-faint">{tamano(e.bytes)}</span>}
            </button>
          ))
        )}
      </div>
      <div className="min-h-0 overflow-auto p-2">
        {abierto == null ? (
          <p className="text-ink-faint">Elegí un archivo. Las bases (.db) se consultan en "Base local".</p>
        ) : /\.db$/.test(abierto) ? (
          <button type="button" onClick={() => onBase(abierto)} className="flex items-center gap-1 rounded border border-line px-2 py-1 text-accent hover:bg-surface-2">
            <Database className="size-3.5" aria-hidden /> Consultar {abierto}
          </button>
        ) : contenido.error ? (
          <p className="text-danger">{(contenido.error as Error).message}</p>
        ) : contenido.data ? (
          <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-ink">{contenido.data.texto}</pre>
        ) : (
          <Loader2 className="size-4 animate-spin text-ink-faint" aria-hidden />
        )}
      </div>
    </div>
  );
}

function tamano(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function Base({ repoId, archivo, onArchivo }: { repoId: string; archivo: string; onArchivo: (ruta: string) => void }) {
  const [sql, setSql] = useState("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') ORDER BY name");
  const consulta = useMutation({ mutationFn: () => api.baseDeLaApp(repoId, archivo, sql) });
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <div className="flex items-center gap-2">
        <span className="text-ink-faint">Base</span>
        <input value={archivo} onChange={(e) => onArchivo(e.target.value)} className="h-7 flex-1 rounded border border-line bg-canvas px-2 font-mono text-ink outline-none focus:border-accent" />
      </div>
      <textarea
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") consulta.mutate();
        }}
        rows={4}
        className="rounded border border-line bg-canvas p-2 font-mono text-[12px] text-ink outline-none focus:border-accent"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={consulta.isPending}
          onClick={() => consulta.mutate()}
          className="flex items-center gap-1 rounded bg-accent px-2 py-1 font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {consulta.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Database className="size-3.5" aria-hidden />}
          Consultar (⌘↵)
        </button>
        <span className="text-ink-faint">Sólo lectura, sobre una copia de la base con su WAL: nada de lo que corras la modifica.</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded bg-canvas p-2">
        {consulta.error ? (
          <p className="text-danger">{(consulta.error as Error).message}</p>
        ) : consulta.data ? (
          <pre className="font-mono text-[11px] text-ink">{consulta.data.texto}</pre>
        ) : null}
      </div>
    </div>
  );
}

const PRESETS = [
  "dumpsys meminfo",
  "dumpsys gfxinfo",
  "dumpsys gfxinfo framestats",
  "dumpsys package",
  "pidof",
  "getprop ro.build.version.release",
  "wm size",
  "wm density",
];

function Diagnostico({ repoId }: { repoId: string }) {
  const [comando, setComando] = useState("dumpsys meminfo");
  const correr = useMutation({ mutationFn: (c: string) => api.diagnosticoDelTelefono(repoId, c) });
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => {
              setComando(p);
              correr.mutate(p);
            }}
            className="rounded border border-line px-1.5 py-0.5 font-mono text-[11px] text-ink-dim hover:border-accent hover:text-ink"
          >
            {p}
          </button>
        ))}
      </div>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          correr.mutate(comando);
        }}
      >
        <span className="font-mono text-ink-faint">adb shell</span>
        <input value={comando} onChange={(e) => setComando(e.target.value)} className="h-7 flex-1 rounded border border-line bg-canvas px-2 font-mono text-ink outline-none focus:border-accent" />
        <button type="submit" disabled={correr.isPending} className="rounded bg-accent px-2 py-1 font-medium text-white hover:opacity-90 disabled:opacity-50">
          Correr
        </button>
      </form>
      <p className="text-ink-faint">Una lista cerrada de diagnósticos, siempre sobre la app del repo: no es un shell del teléfono.</p>
      <div className="min-h-0 flex-1 overflow-auto rounded bg-canvas p-2">
        {correr.isPending ? (
          <Loader2 className="size-4 animate-spin text-ink-faint" aria-hidden />
        ) : correr.error ? (
          <p className="text-danger">{(correr.error as Error).message}</p>
        ) : correr.data ? (
          <pre className="whitespace-pre-wrap font-mono text-[11px] text-ink">{correr.data.texto}</pre>
        ) : null}
      </div>
    </div>
  );
}
