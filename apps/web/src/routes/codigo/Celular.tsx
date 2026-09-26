import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, Loader2, Play, QrCode, RefreshCw, Smartphone, Wifi, X } from "lucide-react";
import { api, type VinculoDeDispositivo } from "../../api.js";

/**
 * El celular de la persona como vista previa de una app móvil, vinculado por
 * el QR de la depuración inalámbrica de Android (como Android Studio). Una app
 * con módulos nativos no se puede ver en el navegador; en el teléfono, con una
 * build de desarrollo instalada una vez, baja el JavaScript del Metro de la
 * sesión y cada edición de un agente se ve al toque. Ver `dispositivos.ts`.
 */
export function PanelDeCelular({ repoId, servicioId, onCerrar }: { repoId: string; servicioId: string; onCerrar: () => void }) {
  const queryClient = useQueryClient();
  const lista = useQuery({ queryKey: ["dispositivos"], queryFn: api.dispositivos, refetchInterval: 5_000 });
  const listos = (lista.data?.dispositivos ?? []).filter((d) => d.estado === "device");
  const [elegido, setElegido] = useState<string | null>(null);
  const serial = elegido && listos.some((d) => d.serial === elegido) ? elegido : (listos[0]?.serial ?? null);
  const [vinculo, setVinculo] = useState<VinculoDeDispositivo | null>(null);

  // Mientras el teléfono no escanea, se pregunta cada segundo cómo va.
  useEffect(() => {
    if (!vinculo || (vinculo.estado !== "esperando" && vinculo.estado !== "vinculando")) return;
    const t = setInterval(() => {
      api
        .vinculoDeDispositivo(vinculo.id)
        .then((v) => {
          setVinculo(v);
          if (v.estado === "listo") {
            if (v.serial) setElegido(v.serial);
            void queryClient.invalidateQueries({ queryKey: ["dispositivos"] });
          }
        })
        .catch(() => {});
    }, 1_000);
    return () => clearInterval(t);
  }, [vinculo, queryClient]);

  const vincular = useMutation({ mutationFn: api.vincularDispositivo, onSuccess: setVinculo });

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
        <Smartphone className="size-3.5 text-ink-dim" aria-hidden />
        <span className="text-[12px] font-semibold text-ink">Tu celular</span>
        <span className="flex-1" />
        <button type="button" title="Cerrar" onClick={onCerrar} className="rounded p-1 text-ink-dim hover:bg-surface-2 hover:text-ink">
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-3 text-[12px]">
        {lista.data && !lista.data.disponible ? (
          <p className="text-ink-dim">
            No encontré <code>adb</code>. Instalá Android Studio (o las platform-tools de Android) y recargá: sin eso no se puede hablar
            con el teléfono.
          </p>
        ) : (
          <>
            <section className="space-y-1.5">
              <div className="flex items-center gap-1">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Dispositivos</h3>
                <span className="flex-1" />
                <button
                  type="button"
                  title="Buscar de nuevo"
                  onClick={() => void lista.refetch()}
                  className="rounded p-0.5 text-ink-faint hover:text-ink"
                >
                  <RefreshCw className={`size-3 ${lista.isFetching ? "animate-spin" : ""}`} aria-hidden />
                </button>
              </div>
              {(lista.data?.dispositivos ?? []).length === 0 ? (
                <p className="text-ink-faint">Ningún teléfono conectado todavía.</p>
              ) : (
                (lista.data?.dispositivos ?? []).map((d) => (
                  <button
                    key={d.serial}
                    type="button"
                    disabled={d.estado !== "device"}
                    onClick={() => setElegido(d.serial)}
                    className={`flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left ${
                      d.serial === serial ? "border-accent bg-accent/10" : "border-line hover:bg-surface-2"
                    }`}
                  >
                    {d.inalambrico ? <Wifi className="size-3.5 shrink-0 text-ink-dim" aria-hidden /> : <Smartphone className="size-3.5 shrink-0 text-ink-dim" aria-hidden />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-ink">{d.modelo ?? d.serial}</span>
                      <span className="block truncate font-mono text-[10px] text-ink-faint">{d.serial}</span>
                    </span>
                    {d.estado !== "device" && (
                      <span className="text-[10px] text-warn" title="Aceptá el aviso de depuración en el teléfono">
                        {d.estado === "unauthorized" ? "aceptá en el teléfono" : d.estado}
                      </span>
                    )}
                  </button>
                ))
              )}
            </section>

            <section className="space-y-2">
              {!vinculo || vinculo.estado === "listo" || vinculo.estado === "vencido" || vinculo.estado === "fallo" ? (
                <>
                  <button
                    type="button"
                    disabled={vincular.isPending}
                    onClick={() => vincular.mutate()}
                    className="flex w-full items-center justify-center gap-1.5 rounded border border-line bg-canvas px-2 py-1.5 text-ink hover:border-accent"
                  >
                    <QrCode className="size-3.5" aria-hidden />
                    Vincular un teléfono por QR
                  </button>
                  {vinculo?.detalle && (
                    <p className={vinculo.estado === "listo" ? "text-ok" : "text-danger"}>{vinculo.detalle}</p>
                  )}
                  {vincular.error && <p className="text-danger">{(vincular.error as Error).message}</p>}
                </>
              ) : (
                <div className="space-y-2 rounded border border-line bg-canvas p-2">
                  <img
                    src={`data:image/svg+xml;utf8,${encodeURIComponent(vinculo.qr)}`}
                    alt="Código QR para vincular el teléfono"
                    className="mx-auto w-52 rounded bg-white p-1"
                  />
                  {vinculo.estado === "vinculando" ? (
                    <p className="flex items-center gap-1.5 text-ink">
                      <Loader2 className="size-3.5 animate-spin text-accent" aria-hidden /> Vinculando…
                    </p>
                  ) : (
                    <ol className="list-decimal space-y-0.5 pl-4 text-ink-dim">
                      <li>El teléfono y esta computadora, en la misma red Wi-Fi.</li>
                      <li>
                        En el teléfono: <b>Opciones de desarrollador → Depuración inalámbrica</b> (prendida).
                      </li>
                      <li>
                        Tocá <b>Vincular dispositivo con código QR</b> y escaneá este código.
                      </li>
                    </ol>
                  )}
                  <button type="button" onClick={() => setVinculo(null)} className="text-[11px] text-ink-faint hover:text-ink">
                    Cancelar
                  </button>
                </div>
              )}
            </section>

            {serial && <AppEnElTelefono repoId={repoId} servicioId={servicioId} serial={serial} />}
          </>
        )}
      </div>
    </aside>
  );
}

function AppEnElTelefono({ repoId, servicioId, serial }: { repoId: string; servicioId: string; serial: string }) {
  const queryClient = useQueryClient();
  const clave = ["app-en-dispositivo", repoId, servicioId, serial];
  const estado = useQuery({
    queryKey: clave,
    queryFn: () => api.appEnDispositivo(repoId, servicioId, serial),
    refetchInterval: (q) => (q.state.data?.instalacion?.estado === "instalando" ? 2_000 : false),
  });
  const abrir = useMutation({ mutationFn: () => api.abrirEnDispositivo(repoId, servicioId, serial) });
  const instalar = useMutation({
    mutationFn: () => api.instalarEnDispositivo(repoId, servicioId, serial),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: clave }),
  });
  const d = estado.data;
  const instalando = d?.instalacion?.estado === "instalando";

  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">La app de la sesión</h3>
      {estado.isLoading ? (
        <Loader2 className="size-4 animate-spin text-ink-faint" aria-hidden />
      ) : estado.error ? (
        <p className="text-danger">{(estado.error as Error).message}</p>
      ) : !d?.paquete ? (
        <p className="text-ink-dim">La app no declara su paquete de Android (<code>expo.android.package</code> en app.json).</p>
      ) : d.instalada && !instalando ? (
        <>
          <p className="flex items-center gap-1.5 text-ink-dim">
            <CheckCircle2 className="size-3.5 text-ok" aria-hidden />
            <span className="font-mono text-[11px]">{d.paquete}</span> instalada.
          </p>
          <button
            type="button"
            disabled={abrir.isPending}
            onClick={() => abrir.mutate()}
            className="flex w-full items-center justify-center gap-1.5 rounded bg-accent px-2 py-1.5 font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {abrir.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
            Abrir en el teléfono
          </button>
          <p className="text-[11px] leading-relaxed text-ink-faint">
            Baja el JavaScript del Metro de la sesión y le habla a la API de la sesión por un túnel de adb. Las ediciones se recargan
            solas; si cambia algo nativo (una dependencia, app.json), reinstalá.
          </p>
          {abrir.isSuccess && <p className="text-ok">Abierta. Si ves una pantalla roja, sacudí el teléfono y tocá Reload.</p>}
          {abrir.error && <p className="text-danger">{(abrir.error as Error).message}</p>}
          <button type="button" onClick={() => instalar.mutate()} className="text-[11px] text-ink-faint hover:text-ink">
            Reinstalar la build de desarrollo
          </button>
        </>
      ) : (
        <>
          {!instalando && (
            <>
              <p className="text-ink-dim">
                <span className="font-mono text-[11px]">{d.paquete}</span> no está instalada. Se compila una build de desarrollo desde la
                sesión, una sola vez (unos minutos la primera).
              </p>
              <button
                type="button"
                disabled={instalar.isPending}
                onClick={() => instalar.mutate()}
                className="flex w-full items-center justify-center gap-1.5 rounded bg-accent px-2 py-1.5 font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                <Download className="size-3.5" aria-hidden />
                Instalar build de desarrollo
              </button>
            </>
          )}
          {instalar.error && <p className="text-danger">{(instalar.error as Error).message}</p>}
        </>
      )}
      {d?.instalacion && (d.instalacion.estado !== "listo" || instalando) && (
        <div className="space-y-1">
          <p className={`flex items-center gap-1.5 ${d.instalacion.estado === "fallo" ? "text-danger" : "text-ink"}`}>
            {instalando && <Loader2 className="size-3.5 animate-spin text-accent" aria-hidden />}
            {instalando ? "Compilando e instalando…" : d.instalacion.estado === "fallo" ? "La instalación falló." : ""}
          </p>
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded bg-canvas p-1.5 font-mono text-[10px] text-ink-dim">
            {d.instalacion.lineas.slice(-60).join("\n")}
          </pre>
        </div>
      )}
    </section>
  );
}
