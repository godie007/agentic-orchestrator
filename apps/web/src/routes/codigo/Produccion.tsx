import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, CircleX, Download, GitCommitHorizontal, KeyRound, Loader2, Package, ShieldCheck } from "lucide-react";
import { api, type ResultadoAab, type ServicioConEstado, type VerificacionAab } from "../../api.js";
import { ConfirmDialog, relativeTime } from "../../ui/index.js";

/**
 * El AAB de producción de la app móvil, a un clic y verificado (ver
 * `apps/server/src/aab.ts`). La pantalla muestra **antes** de construir todo lo
 * que decide qué sale —de qué commit, con qué `.env`, con qué firma, qué
 * versión— porque un AAB se sube a Play y no se deshace.
 */
export function Produccion({ repoId, s }: { repoId: string; s: ServicioConEstado }) {
  const queryClient = useQueryClient();
  const clave = ["aab", repoId, s.id];
  const consulta = useQuery({
    queryKey: clave,
    queryFn: () => api.planDeAab(repoId, s.id),
    refetchInterval: (q) => (q.state.data?.trabajo?.estado === "construyendo" ? 2_000 : false),
  });
  const plan = consulta.data?.plan;
  const trabajo = consulta.data?.trabajo ?? null;
  const construyendo = trabajo?.estado === "construyendo";

  const [version, setVersion] = useState("");
  const [versionCode, setVersionCode] = useState("");
  const [incluirCambios, setIncluirCambios] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  // Las sugerencias entran una vez: después manda lo que escribió la persona.
  const inicializado = useRef(false);
  useEffect(() => {
    if (!plan || inicializado.current) return;
    inicializado.current = true;
    setVersion(plan.sugerida.version);
    setVersionCode(String(plan.sugerida.versionCode));
  }, [plan]);

  const construir = useMutation({
    mutationFn: () => api.construirAab(repoId, s.id, { version, versionCode: Number(versionCode), incluirCambios }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: clave }),
  });

  const minimo = plan ? Math.max(plan.versionCode, plan.anterior?.versionCode ?? 0) + 1 : 1;
  const codeValido = /^\d+$/.test(versionCode) && Number(versionCode) >= minimo;
  const versionValida = /^\d+\.\d+\.\d+$/.test(version);
  const bloqueado = !plan || !plan.entorno || !codeValido || !versionValida || construyendo || construir.isPending;

  const log = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [trabajo?.lineas.length]);

  if (consulta.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-ink-faint">
        <Loader2 className="size-5 animate-spin" aria-hidden />
      </div>
    );
  }
  if (consulta.error || !plan) {
    return <p className="p-4 text-[13px] text-danger">{(consulta.error as Error | null)?.message ?? "No se pudo leer la app."}</p>;
  }

  const campo = "h-8 rounded border border-line bg-canvas px-2 font-mono text-[13px] text-ink outline-none focus:border-accent";

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto max-w-3xl space-y-5 p-5 text-[13px]">
        <header className="flex items-start gap-3">
          <Package className="mt-0.5 size-6 text-accent" aria-hidden />
          <div>
            <h2 className="text-[16px] font-semibold text-ink">AAB de producción para Google Play</h2>
            <p className="text-ink-dim">
              <span className="font-mono">{plan.paquete}</span> · hoy en <b>{plan.version}</b> (versionCode {plan.versionCode})
              {plan.anterior && (
                <>
                  {" "}
                  · último AAB: <span className="font-mono">{plan.anterior.archivo.split("/").at(-1)}</span>
                  {plan.anterior.versionCode != null && ` (versionCode ${plan.anterior.versionCode})`}
                </>
              )}
            </p>
          </div>
        </header>

        {plan.avisos.map((a) => (
          <p key={a} className="flex gap-2 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-ink">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
            {a}
          </p>
        ))}

        <section className="grid gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Versión (versionName)</span>
            <input value={version} onChange={(e) => setVersion(e.target.value.trim())} className={`${campo} w-full`} disabled={construyendo} />
            {!versionValida && <span className="text-[11px] text-danger">Tiene que ser del tipo 1.2.3.</span>}
          </label>
          <label className="space-y-1">
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-ink-faint">versionCode</span>
            <input
              value={versionCode}
              onChange={(e) => setVersionCode(e.target.value.replace(/\D/g, ""))}
              className={`${campo} w-full`}
              disabled={construyendo}
            />
            <span className={`text-[11px] ${codeValido ? "text-ink-faint" : "text-danger"}`}>
              Mínimo {minimo}: Play rechaza uno que no supere al publicado (y uno que se subió y se descartó queda quemado).
            </span>
          </label>

          <div className="space-y-1 sm:col-span-2">
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Código</span>
            <p className="flex items-center gap-1.5 text-ink">
              <GitCommitHorizontal className="size-4 text-ink-dim" aria-hidden />
              <span className="font-mono">{plan.commit.sha.slice(0, 8)}</span>
              <span className="truncate text-ink-dim">
                {plan.commit.asunto} · {plan.commit.rama}
              </span>
            </p>
            {plan.cambiosSinCommitear > 0 && (
              <label className="flex items-start gap-2 text-ink-dim">
                <input type="checkbox" checked={incluirCambios} onChange={(e) => setIncluirCambios(e.target.checked)} disabled={construyendo} className="mt-0.5" />
                <span>
                  Incluir los {plan.cambiosSinCommitear} cambio(s) sin commitear de la app.{" "}
                  <span className="text-ink-faint">
                    Sin marcar, el AAB sale del commit: se sabe exactamente de qué código salió. Marcado, de una instantánea del árbol que queda
                    registrada.
                  </span>
                </span>
              </label>
            )}
          </div>

          <div className="space-y-1">
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Entorno</span>
            {plan.entorno ? (
              <p className="text-ink">
                <span className="font-mono">{plan.entorno.archivo.split("/").at(-1)}</span>{" "}
                <span className="text-ink-dim">({plan.entorno.variables.join(", ")})</span>
                <span className="block text-[11px] text-ink-faint">Se inyecta sólo al proceso del build: no se copia ni se guarda.</span>
              </p>
            ) : (
              <p className="text-danger">Falta el .env de producción.</p>
            )}
          </div>
          <div className="space-y-1">
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Firma</span>
            <p className="flex items-start gap-1.5 text-ink">
              <KeyRound className="mt-0.5 size-3.5 shrink-0 text-ink-dim" aria-hidden />
              <span>
                {plan.firma ? <span className="font-mono">{plan.firma}</span> : "la del prebuild"} + <span className="font-mono">~/.gradle/gradle.properties</span>
                <span className="block text-[11px] text-ink-faint">Las credenciales no pasan por el orquestador: las lee Gradle.</span>
              </span>
            </p>
          </div>
        </section>

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={bloqueado}
            onClick={() => setConfirmando(true)}
            className="flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {construyendo ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Package className="size-4" aria-hidden />}
            {construyendo ? trabajo.paso : `Generar AAB ${version} (${versionCode})`}
          </button>
          {construyendo && <span className="text-ink-faint">desde {relativeTime(trabajo.desde)}</span>}
          {construir.error && <span className="text-danger">{(construir.error as Error).message}</span>}
        </div>

        {trabajo && (
          <section className="space-y-2">
            {trabajo.resultado && <ResultadoDelBuild r={trabajo.resultado} />}
            {trabajo.estado === "fallo" && !trabajo.resultado && (
              <p className="flex items-center gap-1.5 text-danger">
                <CircleX className="size-4" aria-hidden /> El build falló: mirá el final del registro.
              </p>
            )}
            <details open={trabajo.estado !== "listo"}>
              <summary className="cursor-pointer text-[12px] text-ink-dim">Registro del build ({trabajo.lineas.length} líneas)</summary>
              <pre ref={log} className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded bg-canvas p-2 font-mono text-[11px] text-ink-dim">
                {trabajo.lineas.slice(-400).join("\n")}
              </pre>
            </details>
          </section>
        )}

        {plan.historial.length > 0 && (
          <section className="space-y-1.5">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Builds anteriores</h3>
            {plan.historial.map((h) => (
              <div key={h.archivo} className="flex items-center gap-2 rounded border border-line px-2 py-1.5">
                {h.verificaciones.some((v) => v.ok === false) ? (
                  <CircleX className="size-3.5 text-danger" aria-hidden />
                ) : (
                  <ShieldCheck className="size-3.5 text-ok" aria-hidden />
                )}
                <span className="font-mono">{h.version}</span>
                <span className="text-ink-faint">({h.versionCode})</span>
                <span className="font-mono text-[11px] text-ink-faint">{h.commit.slice(0, 8)}</span>
                <span className="text-ink-faint">{relativeTime(h.fecha)}</span>
                <span className="flex-1" />
                <a href={h.url} className="flex items-center gap-1 text-accent hover:underline">
                  <Download className="size-3.5" aria-hidden /> {(h.bytes / 1024 / 1024).toFixed(1)} MB
                </a>
              </div>
            ))}
          </section>
        )}
      </div>

      <ConfirmDialog
        abierto={confirmando}
        titulo={`¿Generar el AAB de producción ${version} (${versionCode})?`}
        detalle={
          <div className="space-y-1.5">
            <p>
              Sale {incluirCambios ? "de una instantánea con los cambios sin commitear" : `del commit ${plan.commit.sha.slice(0, 8)}`}, con{" "}
              {plan.entorno?.archivo.split("/").at(-1)} y firmado con tu clave de subida. Tarda varios minutos.
            </p>
            <p>Al terminar, app.json de la sesión queda en la versión nueva, sin commitear: commitealo con el release.</p>
            <p>El AAB no se sube a Play: lo descargás y lo subís vos.</p>
          </div>
        }
        confirmar="Generar AAB"
        onConfirmar={() => {
          setConfirmando(false);
          construir.mutate();
        }}
        onCancelar={() => setConfirmando(false)}
      />
    </div>
  );
}

function ResultadoDelBuild({ r }: { r: ResultadoAab }) {
  const falla = r.verificaciones.some((v) => v.ok === false);
  return (
    <div className={`space-y-2 rounded-lg border p-3 ${falla ? "border-danger/50 bg-danger/5" : "border-ok/50 bg-ok/5"}`}>
      <div className="flex items-center gap-2">
        {falla ? <CircleX className="size-5 text-danger" aria-hidden /> : <CheckCircle2 className="size-5 text-ok" aria-hidden />}
        <span className="font-semibold text-ink">
          {falla ? "El AAB no pasó la verificación: no lo subas" : "AAB listo para subir a Play"} · {r.version} ({r.versionCode})
        </span>
        <span className="flex-1" />
        <a href={r.url} className="flex items-center gap-1 rounded bg-accent px-2 py-1 text-[12px] font-medium text-white hover:opacity-90">
          <Download className="size-3.5" aria-hidden /> {r.archivo} · {(r.bytes / 1024 / 1024).toFixed(1)} MB
        </a>
      </div>
      <ul className="space-y-1">
        {r.verificaciones.map((v) => (
          <Fila key={v.nombre} v={v} />
        ))}
      </ul>
      <p className="font-mono text-[10px] text-ink-faint">
        sha256 {r.sha256} · commit {r.commit.slice(0, 12)}
        {r.incluyeCambios ? " (instantánea con cambios sin commitear)" : ""}
      </p>
    </div>
  );
}

function Fila({ v }: { v: VerificacionAab }) {
  return (
    <li className="flex items-start gap-2">
      {v.ok === true ? (
        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-ok" aria-hidden />
      ) : v.ok === false ? (
        <CircleX className="mt-0.5 size-3.5 shrink-0 text-danger" aria-hidden />
      ) : (
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden />
      )}
      <span>
        <span className="text-ink">{v.nombre}</span> <span className="text-ink-dim">— {v.detalle}</span>
      </span>
    </li>
  );
}
