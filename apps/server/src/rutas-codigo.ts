import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  argvATexto,
  argvSchema,
  decidirComando,
  origenRepositorioSchema,
  parsearDotenv,
  servicioSchema,
  tokenizar,
  validarPrefijoPermitido,
  type Repositorio,
  type SesionCodigo,
} from "@orq/shared";
import type { Store } from "./db.js";
import type { Runtime } from "./runtime.js";
import { invalid, openSse } from "./routes.js";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { resolverEnWorktree } from "@orq/tools";
import { ErrorGit } from "./git.js";
import { paqueteDeLaApp } from "./dispositivos.js";
import { componentesEnPantalla } from "./inspector-rn.js";
import { empaquetar } from "./scrcpy.js";

/**
 * API del código de un proyecto: cargar repos, mirar la sesión, integrar.
 *
 * Integrar y descartar viven sólo acá, del lado de la persona: no hay
 * herramienta de agente que haga ninguna de las dos. Es la misma regla que
 * publicar — un agente produce, una persona decide qué sale.
 */

const cargaSchema = z.object({
  nombre: z.string().max(120).optional(),
  origen: origenRepositorioSchema,
  ramaBase: z.string().max(200).optional(),
  incluirCambiosSinCommitear: z.boolean().optional(),
});

const comandosSchema = z.object({
  permitidos: z.array(argvSchema).optional(),
  preparar: argvSchema.nullable().optional(),
  test: argvSchema.nullable().optional(),
  verificar: argvSchema.nullable().optional(),
  sinAislamiento: z.boolean().optional(),
});

export function registrarRutasDeCodigo(app: FastifyInstance, deps: { store: Store; runtime: Runtime }): void {
  const { store, runtime } = deps;
  const repos = runtime.repos;

  const conRepo = (id: string): Repositorio | null => store.getRepositorio(id);
  const conSesion = (id: string): { sesion: SesionCodigo; repo: Repositorio } | null => {
    const sesion = store.getSesionCodigo(id);
    const repo = sesion ? store.getRepositorio(sesion.repoId) : null;
    return sesion && repo ? { sesion, repo } : null;
  };

  /** Un error de git se muestra tal cual: es lo único que explica qué pasó. */
  const fallo = (reply: { code: (n: number) => unknown }, error: unknown) => {
    reply.code(error instanceof ErrorGit ? 422 : 400);
    return { error: error instanceof Error ? error.message : String(error) };
  };

  app.get("/api/companies/:companyId/repos", async (request) => {
    const { companyId } = request.params as { companyId: string };
    return store.listRepositorios(companyId).map((repo) => ({
      repo,
      sesion: repos.sesionAbierta(repo.id, companyId),
      clon: repos.rutaClon(repo),
    }));
  });

  app.post("/api/companies/:companyId/repos", async (request, reply) => {
    const { companyId } = request.params as { companyId: string };
    if (!store.getCompany(companyId)) {
      reply.code(404);
      return { error: "No existe la empresa." };
    }
    const parsed = cargaSchema.safeParse(request.body ?? {});
    if (!parsed.success) return invalid(reply, parsed.error);
    try {
      const cargado = await repos.cargar(companyId, {
        origen: parsed.data.origen,
        ...(parsed.data.nombre ? { nombre: parsed.data.nombre } : {}),
        ...(parsed.data.ramaBase ? { ramaBase: parsed.data.ramaBase } : {}),
        ...(parsed.data.incluirCambiosSinCommitear ? { incluirCambiosSinCommitear: true } : {}),
      });
      await runtime.registrarHerramientasDeCodigo(companyId);
      return cargado;
    } catch (error) {
      return fallo(reply, error);
    }
  });

  /**
   * La allowlist la edita una persona. Cada entrada se valida con la misma
   * regla que usa la herramienta: un prefijo que lo permite todo (`npx`,
   * `bash`, `npm run` a secas) no entra, y el rechazo dice cuál y por qué.
   */
  app.patch("/api/repos/:repoId/comandos", async (request, reply) => {
    const { repoId } = request.params as { repoId: string };
    const repo = conRepo(repoId);
    if (!repo) {
      reply.code(404);
      return { error: "No existe el repo." };
    }
    const parsed = comandosSchema.safeParse(request.body ?? {});
    if (!parsed.success) return invalid(reply, parsed.error);
    for (const prefijo of parsed.data.permitidos ?? []) {
      const validacion = validarPrefijoPermitido(prefijo);
      if (!validacion.ok) {
        reply.code(400);
        return { error: `"${prefijo.join(" ")}": ${validacion.motivo}` };
      }
    }
    const limpio = Object.fromEntries(
      Object.entries(parsed.data).filter(([, valor]) => valor !== undefined),
    ) as Partial<Repositorio["comandos"]>;
    return repos.actualizarComandos(repo, limpio);
  });

  // Renombrar no pide detener la corrida: el repo también se encuentra por su
  // slug, que no cambia, así que un agente que en este turno todavía dice el
  // nombre viejo sigue llegando al mismo lugar.
  app.post("/api/repos/:repoId/renombrar", async (request, reply) => {
    const { repoId } = request.params as { repoId: string };
    const repo = conRepo(repoId);
    if (!repo) {
      reply.code(404);
      return { error: "No existe el repo." };
    }
    const { nombre } = (request.body ?? {}) as { nombre?: unknown };
    if (typeof nombre !== "string") {
      reply.code(400);
      return { error: "Falta el nombre." };
    }
    try {
      return repos.renombrar(repo, nombre);
    } catch (error) {
      reply.code(409);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  app.delete("/api/repos/:repoId", async (request, reply) => {
    const { repoId } = request.params as { repoId: string };
    const repo = conRepo(repoId);
    if (!repo) {
      reply.code(404);
      return { error: "No existe el repo." };
    }
    if (runtime.tieneCorridaViva(repo.companyId)) {
      reply.code(409);
      return { error: "Hay una corrida en curso trabajando sobre el código. Detenela antes." };
    }
    runtime.servicios.detenerDelRepo(repo.id);
    const { respaldo } = await repos.eliminar(repo);
    await runtime.registrarHerramientasDeCodigo(repo.companyId);
    return { ok: true, respaldo };
  });

  app.post("/api/repos/:repoId/sesion", async (request, reply) => {
    const { repoId } = request.params as { repoId: string };
    const repo = conRepo(repoId);
    if (!repo) {
      reply.code(404);
      return { error: "No existe el repo." };
    }
    try {
      return await repos.abrirSesion(repo);
    } catch (error) {
      return fallo(reply, error);
    }
  });

  app.get("/api/sesiones/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const encontrada = conSesion(id);
    if (!encontrada) {
      reply.code(404);
      return { error: "No existe la sesión." };
    }
    const { sesion, repo } = encontrada;
    if (sesion.estado !== "abierta") return { sesion, estado: null, log: [] };
    try {
      return {
        sesion,
        estado: await repos.estado(sesion, repo),
        log: await repos.log(sesion, repo),
      };
    } catch (error) {
      return fallo(reply, error);
    }
  });

  app.get("/api/sesiones/:id/diff", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { ruta } = request.query as { ruta?: string };
    const encontrada = conSesion(id);
    if (!encontrada || encontrada.sesion.estado !== "abierta") {
      reply.code(404);
      return { error: "No existe la sesión abierta." };
    }
    try {
      return { diff: await repos.diff(encontrada.sesion, encontrada.repo, ruta) };
    } catch (error) {
      return fallo(reply, error);
    }
  });

  app.get("/api/sesiones/:id/patch", async (request, reply) => {
    const { id } = request.params as { id: string };
    const encontrada = conSesion(id);
    if (!encontrada || encontrada.sesion.estado !== "abierta") {
      reply.code(404);
      return { error: "No existe la sesión abierta." };
    }
    const patch = await repos.patch(encontrada.sesion, encontrada.repo);
    reply
      .header("content-type", "text/x-patch; charset=utf-8")
      .header(
        "content-disposition",
        `attachment; filename="${encontrada.repo.slug}-${encontrada.sesion.rama.replace(/\//g, "-")}.patch"`,
      );
    return patch;
  });

  app.post("/api/sesiones/:id/integrar", async (request, reply) => {
    const { id } = request.params as { id: string };
    const encontrada = conSesion(id);
    if (!encontrada) {
      reply.code(404);
      return { error: "No existe la sesión." };
    }
    if (runtime.tieneCorridaViva(encontrada.repo.companyId)) {
      reply.code(409);
      return { error: "Hay una corrida en curso escribiendo en esta sesión. Esperá a que termine o detenela." };
    }
    const { subir } = (request.body ?? {}) as { subir?: unknown };
    try {
      // Los servicios corren sobre el worktree que integrar se lleva. En la
      // rama del proyecto publicar no lo cierra: siguen andando.
      const seCierra = !(repos.usaRamaDelProyecto(encontrada.repo) && !encontrada.sesion.rama.startsWith("orq/"));
      if (seCierra) runtime.servicios.detenerDelRepo(encontrada.repo.id);
      const resultado = await repos.integrar(encontrada.sesion, encontrada.repo, { subir: subir === true });
      if (!resultado.ok) {
        reply.code(409);
        return { error: resultado.motivo, ...resultado };
      }
      return resultado;
    } catch (error) {
      return fallo(reply, error);
    }
  });

  app.post("/api/sesiones/:id/descartar", async (request, reply) => {
    const { id } = request.params as { id: string };
    const encontrada = conSesion(id);
    if (!encontrada) {
      reply.code(404);
      return { error: "No existe la sesión." };
    }
    if (runtime.tieneCorridaViva(encontrada.repo.companyId)) {
      reply.code(409);
      return { error: "Hay una corrida en curso escribiendo en esta sesión. Detenela antes de descartar." };
    }
    runtime.servicios.detenerDelRepo(encontrada.repo.id);
    await repos.descartar(encontrada.sesion, encontrada.repo);
    return { ok: true };
  });

  // --- Servicios (vista previa de un monorepo) ------------------------------

  /**
   * La configuración de cada servicio más su estado vivo. Los `.env` se
   * describen —qué archivo, si existe, cuántas variables— pero sus valores no
   * salen nunca del servidor.
   */
  app.get("/api/repos/:repoId/servicios", async (request, reply) => {
    const { repoId } = request.params as { repoId: string };
    const repo = conRepo(repoId);
    if (!repo) {
      reply.code(404);
      return { error: "No existe el repo." };
    }
    const preparados = runtime.serviciosPreparados(repo);
    return {
      servicios: await Promise.all(
        repo.servicios.map(async (servicio) => ({
          ...servicio,
          archivosEntorno: await Promise.all(
            servicio.archivosEntorno.map(async (ruta) => {
              try {
                const texto = await readFile(ruta, "utf8");
                return { ruta, existe: true, variables: Object.keys(parsearDotenv(texto)).length };
              } catch {
                return { ruta, existe: false, variables: 0 };
              }
            }),
          ),
          preparado: preparados[servicio.id] ?? null,
          vivo: runtime.servicios.vista(repo.id, servicio.id),
        })),
      ),
    };
  });

  app.post("/api/repos/:repoId/servicios/detectar", async (request, reply) => {
    const { repoId } = request.params as { repoId: string };
    const repo = conRepo(repoId);
    if (!repo) {
      reply.code(404);
      return { error: "No existe el repo." };
    }
    return repos.redetectarServicios(repo);
  });

  /** Alta o edición de un servicio. El id no cambia: es lo que nombran los agentes. */
  app.put("/api/repos/:repoId/servicios/:servicioId", async (request, reply) => {
    const { repoId, servicioId } = request.params as { repoId: string; servicioId: string };
    const repo = conRepo(repoId);
    if (!repo) {
      reply.code(404);
      return { error: "No existe el repo." };
    }
    const parsed = servicioSchema.safeParse({ ...(request.body as object), id: servicioId });
    if (!parsed.success) return invalid(reply, parsed.error);
    const servicio = parsed.data;
    // Sólo archivos que se llaman como un `.env`: el servidor los lee y los
    // inyecta en un proceso que corre código de un agente, así que esto no
    // puede ser la forma de meterle `~/.ssh/id_rsa` como variable.
    const noEsEnv = servicio.archivosEntorno.find((ruta) => !isAbsolute(ruta) || !/^\.env(\..+)?$|\.env$/.test(basename(ruta)));
    if (noEsEnv) {
      reply.code(400);
      return { error: `"${noEsEnv}" no es un archivo .env con ruta absoluta.` };
    }
    if (servicio.carpeta) {
      const dentro = await resolverEnWorktree(repos.rutaClon(repo), servicio.carpeta);
      if (!dentro.ok) {
        reply.code(400);
        return { error: dentro.motivo };
      }
      servicio.carpeta = dentro.relativa;
    }
    const lista = repo.servicios.some((s) => s.id === servicioId)
      ? repo.servicios.map((s) => (s.id === servicioId ? servicio : s))
      : [...repo.servicios, servicio];
    return repos.actualizarServicios(repo, lista);
  });

  app.delete("/api/repos/:repoId/servicios/:servicioId", async (request, reply) => {
    const { repoId, servicioId } = request.params as { repoId: string; servicioId: string };
    const repo = conRepo(repoId);
    if (!repo) {
      reply.code(404);
      return { error: "No existe el repo." };
    }
    runtime.servicios.detener(repo.id, servicioId);
    return repos.actualizarServicios(repo, repo.servicios.filter((s) => s.id !== servicioId));
  });

  // Preparar tarda (una instalación son minutos): se contesta al toque y el
  // avance se ve en los logs. El `.catch` no es decorativo: una promesa sin
  // dueño tira el servidor entero (ver "Trampas conocidas").
  app.post("/api/repos/:repoId/servicios/:servicioId/preparar", async (request, reply) => {
    const { repoId, servicioId } = request.params as { repoId: string; servicioId: string };
    const repo = conRepo(repoId);
    if (!repo?.servicios.some((s) => s.id === servicioId)) {
      reply.code(404);
      return { error: "No existe el servicio." };
    }
    void runtime.prepararServicio(repo, servicioId).catch((error: unknown) => {
      request.log.warn({ err: error }, "no se pudo preparar el servicio");
    });
    return { ok: true };
  });

  app.post("/api/repos/:repoId/servicios/:servicioId/arrancar", async (request, reply) => {
    const { repoId, servicioId } = request.params as { repoId: string; servicioId: string };
    const repo = conRepo(repoId);
    if (!repo?.servicios.some((s) => s.id === servicioId)) {
      reply.code(404);
      return { error: "No existe el servicio." };
    }
    try {
      return await runtime.arrancarServicio(repo, servicioId);
    } catch (error) {
      reply.code(409);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  // --- El celular como vista previa de una app móvil ---------------------------

  app.get("/api/dispositivos", async () => ({
    disponible: runtime.dispositivos.disponible,
    dispositivos: await runtime.dispositivos.listar(),
    espejo: await runtime.dispositivos.motorDeEspejo(),
  }));

  app.post("/api/dispositivos/vincular", async (_request, reply) => {
    try {
      return runtime.dispositivos.vincular();
    } catch (error) {
      reply.code(409);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  app.get("/api/dispositivos/vincular/:id", async (request, reply) => {
    const vinculo = runtime.dispositivos.vinculo((request.params as { id: string }).id);
    if (!vinculo) {
      reply.code(404);
      return { error: "No existe ese vínculo." };
    }
    return vinculo;
  });

  // --- Depuración de la app en el teléfono (panel del IDE) ---------------------------
  // Las mismas reglas que las herramientas de los agentes (depuracion-movil.ts):
  // el panel de la persona no es un shell, por la misma razón que la terminal
  // del IDE tampoco lo es — la API escucha en localhost.

  const telefono = (repoId: string) => {
    const repo = conRepo(repoId);
    if (!repo) return null;
    return { repo, t: runtime.telefonoStorage(repo.companyId) };
  };
  const responder = async <T extends { ok: boolean }>(reply: FastifyReply, r: Promise<T>) => {
    const res = await r;
    if (!res.ok) reply.code(409);
    return res.ok ? res : { error: (res as unknown as { motivo: string }).motivo };
  };

  app.get("/api/repos/:repoId/telefono/logs", async (request, reply) => {
    const x = telefono((request.params as { repoId: string }).repoId);
    if (!x) return reply.code(404).send({ error: "No existe el repo." });
    const q = request.query as { alcance?: string; nivel?: string; lineas?: string; buscar?: string };
    const nivel = (["V", "D", "I", "W", "E"] as const).find((n) => n === q.nivel) ?? "I";
    return responder(
      reply,
      x.t.logs(x.repo.id, {
        alcance: q.alcance === "fallas" ? "fallas" : "app",
        nivel,
        lineas: Math.max(10, Math.min(1500, Number(q.lineas ?? 300) || 300)),
        ...(q.buscar?.trim() ? { buscar: q.buscar.trim() } : {}),
      }),
    );
  });

  app.get("/api/repos/:repoId/telefono/estado", async (request, reply) => {
    const x = telefono((request.params as { repoId: string }).repoId);
    if (!x) return reply.code(404).send({ error: "No existe el repo." });
    return responder(reply, x.t.estado(x.repo.id));
  });

  app.get("/api/repos/:repoId/telefono/archivos", async (request, reply) => {
    const x = telefono((request.params as { repoId: string }).repoId);
    if (!x) return reply.code(404).send({ error: "No existe el repo." });
    const { ruta = ".", leer } = request.query as { ruta?: string; leer?: string };
    return responder(reply, leer === "1" ? x.t.leerArchivo(x.repo.id, ruta) : x.t.listarArchivos(x.repo.id, ruta));
  });

  app.post("/api/repos/:repoId/telefono/base", async (request, reply) => {
    const x = telefono((request.params as { repoId: string }).repoId);
    if (!x) return reply.code(404).send({ error: "No existe el repo." });
    const cuerpo = z.object({ archivo: z.string().min(1).max(300), sql: z.string().min(1).max(5_000) }).safeParse(request.body);
    if (!cuerpo.success) return invalid(reply, cuerpo.error);
    return responder(reply, x.t.consultarBase(x.repo.id, cuerpo.data.archivo, cuerpo.data.sql));
  });

  app.post("/api/repos/:repoId/telefono/diagnostico", async (request, reply) => {
    const x = telefono((request.params as { repoId: string }).repoId);
    if (!x) return reply.code(404).send({ error: "No existe el repo." });
    const cuerpo = z.object({ comando: z.string().min(1).max(300) }).safeParse(request.body);
    if (!cuerpo.success) return invalid(reply, cuerpo.error);
    return responder(reply, x.t.diagnostico(x.repo.id, cuerpo.data.comando));
  });

  app.post("/api/repos/:repoId/telefono/reiniciar", async (request, reply) => {
    const x = telefono((request.params as { repoId: string }).repoId);
    if (!x) return reply.code(404).send({ error: "No existe el repo." });
    return responder(reply, x.t.reiniciar(x.repo.id));
  });

  app.post("/api/repos/:repoId/telefono/limpiar-datos", async (request, reply) => {
    const x = telefono((request.params as { repoId: string }).repoId);
    if (!x) return reply.code(404).send({ error: "No existe el repo." });
    return responder(reply, x.t.limpiarDatos(x.repo.id));
  });

  // --- El AAB de producción ------------------------------------------------------

  app.get("/api/repos/:repoId/servicios/:servicioId/aab", async (request, reply) => {
    const { repoId, servicioId } = request.params as { repoId: string; servicioId: string };
    const repo = conRepo(repoId);
    if (!repo) {
      reply.code(404);
      return { error: "No existe el repo." };
    }
    try {
      return {
        plan: await runtime.aab.plan(runtime.contextoAab(repo, servicioId)),
        trabajo: runtime.aab.trabajo(`${repoId}:${servicioId}`),
      };
    } catch (error) {
      reply.code(409);
      return { error: error instanceof Error ? error.message : String(error), trabajo: runtime.aab.trabajo(`${repoId}:${servicioId}`) };
    }
  });

  app.get("/api/repos/:repoId/servicios/:servicioId/aab/trabajo", async (request) => {
    const { repoId, servicioId } = request.params as { repoId: string; servicioId: string };
    return { trabajo: runtime.aab.trabajo(`${repoId}:${servicioId}`) };
  });

  app.post("/api/repos/:repoId/servicios/:servicioId/aab", async (request, reply) => {
    const { repoId, servicioId } = request.params as { repoId: string; servicioId: string };
    const cuerpo = z
      .object({ version: z.string().regex(/^\d+\.\d+\.\d+$/), versionCode: z.number().int().positive().max(2_100_000_000), incluirCambios: z.boolean().default(false) })
      .safeParse(request.body);
    if (!cuerpo.success) return invalid(reply, cuerpo.error);
    const repo = conRepo(repoId);
    if (!repo) {
      reply.code(404);
      return { error: "No existe el repo." };
    }
    try {
      return { trabajo: runtime.aab.construir(`${repoId}:${servicioId}`, runtime.contextoAab(repo, servicioId), cuerpo.data) };
    } catch (error) {
      reply.code(409);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  // El espejo: la pantalla en vivo, los toques y lo que hay en pantalla.
  const conTelefono = async (serial: string) => {
    const lista = await runtime.dispositivos.listar();
    if (!lista.some((d) => d.serial === serial && d.estado === "device")) throw new Error("Ese teléfono no está conectado.");
  };

  app.get("/api/dispositivos/:serial/pantalla", async (request, reply) => {
    const { serial } = request.params as { serial: string };
    try {
      await conTelefono(serial);
    } catch (error) {
      reply.code(409);
      return { error: error instanceof Error ? error.message : String(error) };
    }
    reply.hijack();
    const borde = "cuadro";
    reply.raw.writeHead(200, {
      "Content-Type": `multipart/x-mixed-replace; boundary=${borde}`,
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write(`--${borde}\r\n`);
    // El cierre de la **respuesta** es el de la conexión: el `close` del
    // pedido llega apenas se leyó un GET, y con él la captura quedaba viva.
    let cortar: (() => void) | null = null;
    let cerrado = false;
    const cerrar = () => {
      cerrado = true;
      cortar?.();
      if (!reply.raw.writableEnded) reply.raw.end();
    };
    reply.raw.on("close", cerrar);
    try {
      cortar = await runtime.dispositivos.transmitir(
        serial,
        (jpeg) => {
          if (reply.raw.writableEnded) return;
          // El borde va **después** de cada cuadro: Chrome pinta una parte
          // recién cuando ve el borde siguiente, y con la pantalla quieta el
          // último cuadro quedaba sin pintar.
          reply.raw.write(`Content-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`);
          reply.raw.write(jpeg);
          reply.raw.write(`\r\n--${borde}\r\n`);
        },
        () => {
          if (!reply.raw.writableEnded) reply.raw.end();
        },
      );
      if (cerrado) cortar();
    } catch {
      cerrar();
    }
  });

  /**
   * El video del teléfono con scrcpy: los paquetes H.264 tal cual los armó el
   * teléfono, con su tipo, para que el navegador los decodifique con WebCodecs.
   * Formato: `[tipo u8][largo u32][datos]` (ver `scrcpy.ts`).
   */
  app.get("/api/dispositivos/:serial/video", async (request, reply) => {
    const { serial } = request.params as { serial: string };
    if ((await runtime.dispositivos.motorDeEspejo()).motor !== "scrcpy") {
      reply.code(409);
      return { error: "scrcpy no está instalado: se usa el espejo de respaldo.", motor: "screenrecord" };
    }
    try {
      await conTelefono(serial);
    } catch (error) {
      reply.code(409);
      return { error: error instanceof Error ? error.message : String(error) };
    }
    reply.hijack();
    reply.raw.writeHead(200, { "Content-Type": "application/octet-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
    let soltar: (() => void) | null = null;
    let cerrado = false;
    const cerrar = () => {
      if (cerrado) return;
      cerrado = true;
      soltar?.();
      if (!reply.raw.writableEnded) reply.raw.end();
    };
    reply.raw.on("close", cerrar);
    try {
      soltar = await runtime.dispositivos.mirar(
        serial,
        (p) => {
          if (!reply.raw.writableEnded) reply.raw.write(empaquetar(p));
        },
        cerrar,
      );
      if (cerrado) soltar();
    } catch (error) {
      request.log.warn({ error }, "no se pudo abrir el espejo con scrcpy");
      cerrar();
    }
  });

  app.post("/api/dispositivos/:serial/toque", async (request, reply) => {
    const { serial } = request.params as { serial: string };
    const cuerpo = z
      .object({ accion: z.enum(["abajo", "mover", "arriba"]), x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
      .safeParse(request.body);
    if (!cuerpo.success) return invalid(reply, cuerpo.error);
    try {
      runtime.dispositivos.toque(serial, cuerpo.data.accion, cuerpo.data.x, cuerpo.data.y);
      return { ok: true };
    } catch (error) {
      reply.code(409);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  app.post("/api/dispositivos/:serial/rueda", async (request, reply) => {
    const { serial } = request.params as { serial: string };
    const cuerpo = z
      .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), h: z.number().min(-16).max(16), v: z.number().min(-16).max(16) })
      .safeParse(request.body);
    if (!cuerpo.success) return invalid(reply, cuerpo.error);
    try {
      runtime.dispositivos.rueda(serial, cuerpo.data.x, cuerpo.data.y, cuerpo.data.h, cuerpo.data.v);
      return { ok: true };
    } catch (error) {
      reply.code(409);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  const cuerpoToque = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
  const cuerpoDeslizar = z.object({ desde: cuerpoToque, hasta: cuerpoToque, ms: z.number().min(0).max(5_000) });
  const cuerpoTecla = z.object({ tecla: z.enum(["atras", "inicio", "recientes", "enter", "borrar", "menu"]) });
  const cuerpoTexto = z.object({ texto: z.string().min(1).max(300) });

  const accion = <T extends z.ZodTypeAny>(ruta: string, esquema: T, hacer: (serial: string, datos: z.infer<T>) => Promise<unknown>) =>
    app.post(`/api/dispositivos/:serial/${ruta}`, async (request, reply) => {
      const { serial } = request.params as { serial: string };
      const cuerpo = esquema.safeParse(request.body);
      if (!cuerpo.success) return invalid(reply, cuerpo.error);
      try {
        const extra = await hacer(serial, cuerpo.data);
        return { ok: true, ...(extra && typeof extra === "object" ? extra : {}) };
      } catch (error) {
        reply.code(409);
        return { error: error instanceof Error ? error.message : String(error) };
      }
    });
  accion("tocar", cuerpoToque, (serial, d) => runtime.dispositivos.tocar(serial, d.x, d.y));
  accion("deslizar", cuerpoDeslizar, (serial, d) => runtime.dispositivos.deslizar(serial, d.desde, d.hasta, d.ms));
  accion("tecla", cuerpoTecla, (serial, d) => runtime.dispositivos.tecla(serial, d.tecla));
  accion("texto", cuerpoTexto, (serial, d) => runtime.dispositivos.escribir(serial, d.texto));

  app.get("/api/dispositivos/:serial/arbol", async (request, reply) => {
    const { serial } = request.params as { serial: string };
    try {
      return await runtime.dispositivos.arbol(serial);
    } catch (error) {
      reply.code(409);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  /** Qué componentes dibujan lo señalado: se le pregunta a la app por el depurador de Metro. */
  app.post("/api/repos/:repoId/servicios/:servicioId/dispositivo/componentes", async (request, reply) => {
    const { repoId, servicioId } = request.params as { repoId: string; servicioId: string };
    const cuerpo = z.object({ buscados: z.array(z.string().max(300)).max(20) }).safeParse(request.body);
    if (!cuerpo.success) return invalid(reply, cuerpo.error);
    const { metro } = runtime.servicios.puertosParaDispositivo(repoId, servicioId);
    if (metro == null) return { componentes: [], pantallas: [], aviso: "El servicio no está levantado." };
    try {
      return (await componentesEnPantalla(metro, cuerpo.data.buscados)) ?? { componentes: [], pantallas: [], aviso: "La app no dibuja ese texto con React." };
    } catch (error) {
      return { componentes: [], pantallas: [], aviso: error instanceof Error ? error.message : String(error) };
    }
  });

  const cuerpoDispositivo = z.object({ serial: z.string().min(1).max(200) });

  /** ¿Está instalada la app en ese teléfono? Y cómo va su instalación, si hay una. */
  app.get("/api/repos/:repoId/servicios/:servicioId/dispositivo", async (request, reply) => {
    const { repoId, servicioId } = request.params as { repoId: string; servicioId: string };
    const { serial } = request.query as { serial?: string };
    const repo = conRepo(repoId);
    if (!repo?.servicios.some((s) => s.id === servicioId) || !serial) {
      reply.code(404);
      return { error: "No existe el servicio o falta el teléfono." };
    }
    try {
      const { carpeta } = runtime.carpetaDeServicio(repo, servicioId);
      const paquete = await paqueteDeLaApp(carpeta);
      return {
        paquete,
        instalada: paquete ? await runtime.dispositivos.instalada(serial, paquete) : false,
        instalacion: runtime.dispositivos.instalacion(`${repoId}:${servicioId}:${serial}`),
      };
    } catch (error) {
      reply.code(409);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  app.post("/api/repos/:repoId/servicios/:servicioId/dispositivo/abrir", async (request, reply) => {
    const { repoId, servicioId } = request.params as { repoId: string; servicioId: string };
    const cuerpo = cuerpoDispositivo.safeParse(request.body);
    if (!cuerpo.success) return invalid(reply, cuerpo.error);
    const repo = conRepo(repoId);
    if (!repo?.servicios.some((s) => s.id === servicioId)) {
      reply.code(404);
      return { error: "No existe el servicio." };
    }
    try {
      const { carpeta } = runtime.carpetaDeServicio(repo, servicioId);
      const paquete = await paqueteDeLaApp(carpeta);
      if (!paquete) throw new Error("La app no declara su paquete de Android (expo.android.package en app.json).");
      const { metro, puertos } = runtime.servicios.puertosParaDispositivo(repoId, servicioId);
      if (metro == null) throw new Error("Levantá el servicio primero: el teléfono baja el JavaScript de su Metro.");
      await runtime.dispositivos.abrir(cuerpo.data.serial, { paquete, metro, puertos, destino: { repoId, servicioId } });
      return { ok: true, paquete, metro, puertos };
    } catch (error) {
      reply.code(409);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  app.post("/api/repos/:repoId/servicios/:servicioId/dispositivo/instalar", async (request, reply) => {
    const { repoId, servicioId } = request.params as { repoId: string; servicioId: string };
    const cuerpo = cuerpoDispositivo.safeParse(request.body);
    if (!cuerpo.success) return invalid(reply, cuerpo.error);
    const repo = conRepo(repoId);
    if (!repo?.servicios.some((s) => s.id === servicioId)) {
      reply.code(404);
      return { error: "No existe el servicio." };
    }
    try {
      const { carpeta, tmp } = runtime.carpetaDeServicio(repo, servicioId);
      return runtime.dispositivos.instalar(`${repoId}:${servicioId}:${cuerpo.data.serial}`, cuerpo.data.serial, carpeta, tmp);
    } catch (error) {
      reply.code(409);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  app.post("/api/repos/:repoId/servicios/:servicioId/detener", async (request) => {
    const { repoId, servicioId } = request.params as { repoId: string; servicioId: string };
    runtime.servicios.detener(repoId, servicioId);
    return runtime.servicios.vista(repoId, servicioId);
  });

  app.get("/api/repos/:repoId/servicios/:servicioId/logs", async (request) => {
    const { repoId, servicioId } = request.params as { repoId: string; servicioId: string };
    const desde = Number((request.query as { desde?: string }).desde ?? 0) || 0;
    return { ...runtime.servicios.lineasDesde(repoId, servicioId, desde), vivo: runtime.servicios.vista(repoId, servicioId) };
  });

  const probarSchema = z.object({
    metodo: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]).default("GET"),
    ruta: z.string().min(1).max(2000),
    cuerpo: z.string().max(200_000).optional(),
    cabeceras: z.record(z.string().max(8_000)).optional(),
  });

  /** La consola de la API: el pedido sale del servidor, así no depende del CORS del backend. */
  app.post("/api/repos/:repoId/servicios/:servicioId/probar", async (request, reply) => {
    const { repoId, servicioId } = request.params as { repoId: string; servicioId: string };
    const parsed = probarSchema.safeParse(request.body ?? {});
    if (!parsed.success) return invalid(reply, parsed.error);
    try {
      return await runtime.servicios.probar(repoId, servicioId, {
        metodo: parsed.data.metodo,
        ruta: parsed.data.ruta,
        ...(parsed.data.cuerpo != null ? { cuerpo: parsed.data.cuerpo } : {}),
        ...(parsed.data.cabeceras ? { cabeceras: parsed.data.cabeceras } : {}),
      });
    } catch (error) {
      reply.code(409);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  // --- IDE ------------------------------------------------------------------

  /**
   * El árbol del repo para el explorador, con el estado git de cada archivo y
   * quién está escribiendo ahora. Sin sesión se muestra la rama base en sólo
   * lectura: mirar no abre una sesión.
   */
  app.get("/api/repos/:repoId/archivos", async (request, reply) => {
    const { repoId } = request.params as { repoId: string };
    const repo = conRepo(repoId);
    if (!repo) {
      reply.code(404);
      return { error: "No existe el repo." };
    }
    const sesion = repos.sesionAbierta(repo.id, repo.companyId);
    try {
      const archivos = await repos.listarArchivos(repo, sesion);
      const estado = sesion ? await repos.estado(sesion, repo) : null;
      return {
        sesion,
        archivos,
        cambios: estado?.archivos ?? [],
        sensibles: estado?.sensibles ?? [],
        commits: estado?.commits ?? 0,
        pendientes: sesion ? await repos.tieneCambiosPendientes(sesion, repo) : false,
        escritor: runtime.titularDeEscritura(repo.id),
        corridaViva: runtime.tieneCorridaViva(repo.companyId),
      };
    } catch (error) {
      return fallo(reply, error);
    }
  });

  app.get("/api/repos/:repoId/buscar", async (request, reply) => {
    const { repoId } = request.params as { repoId: string };
    const { q, mayusculas, regex } = request.query as { q?: string; mayusculas?: string; regex?: string };
    const repo = conRepo(repoId);
    if (!repo) {
      reply.code(404);
      return { error: "No existe el repo." };
    }
    return repos.buscarTexto(repo, repos.sesionAbierta(repo.id, repo.companyId), q ?? "", {
      mayusculas: mayusculas === "1",
      regex: regex === "1",
    });
  });

  app.get("/api/repos/:repoId/archivo", async (request, reply) => {
    const { repoId } = request.params as { repoId: string };
    const { ruta, ref } = request.query as { ruta?: string; ref?: string };
    const repo = conRepo(repoId);
    if (!repo || !ruta) {
      reply.code(404);
      return { error: "Falta el repo o la ruta." };
    }
    const sesion = repos.sesionAbierta(repo.id, repo.companyId);
    const referencia = ref === "base" || (ref && /^[0-9a-f]{7,40}\^?$/.test(ref)) ? ref : "actual";
    const leido = await repos.leerArchivo(repo, sesion, ruta, referencia);
    if (!leido.ok) {
      reply.code(404);
      return { error: leido.motivo };
    }
    return { ruta, ...leido };
  });

  const guardarSchema = z.object({
    ruta: z.string().min(1).max(1000),
    contenido: z.string(),
    /** Hash de lo que cargó el editor; `null` si es un archivo nuevo. */
    hash: z.string().nullable().optional(),
  });

  /**
   * Guarda lo que editó una persona. No mientras un agente tiene el arriendo:
   * dos escritores sobre el mismo árbol se pisan, sean agentes o no. Y no si
   * el archivo cambió en disco desde que se abrió (409 con `conflicto`).
   */
  app.put("/api/repos/:repoId/archivo", async (request, reply) => {
    const { repoId } = request.params as { repoId: string };
    const repo = conRepo(repoId);
    if (!repo) {
      reply.code(404);
      return { error: "No existe el repo." };
    }
    const parsed = guardarSchema.safeParse(request.body ?? {});
    if (!parsed.success) return invalid(reply, parsed.error);
    const escritor = runtime.titularDeEscritura(repo.id);
    if (escritor) {
      reply.code(409);
      return { error: `${escritor} está editando este repo en su turno. Guardá cuando termine: tu cambio sigue en el editor.` };
    }
    try {
      const sesion = await repos.abrirSesion(repo);
      const resultado = await repos.escribirArchivo(
        sesion,
        repo,
        parsed.data.ruta,
        parsed.data.contenido,
        parsed.data.hash,
      );
      if (!resultado.ok) {
        reply.code(resultado.conflicto ? 409 : 400);
        return { error: resultado.motivo, conflicto: resultado.conflicto ?? false };
      }
      return { ...resultado, sesionId: sesion.id };
    } catch (error) {
      return fallo(reply, error);
    }
  });

  app.delete("/api/repos/:repoId/archivo", async (request, reply) => {
    const { repoId } = request.params as { repoId: string };
    const { ruta } = request.query as { ruta?: string };
    const repo = conRepo(repoId);
    if (!repo || !ruta) {
      reply.code(404);
      return { error: "Falta el repo o la ruta." };
    }
    const escritor = runtime.titularDeEscritura(repo.id);
    if (escritor) {
      reply.code(409);
      return { error: `${escritor} está editando este repo en su turno.` };
    }
    const sesion = await repos.abrirSesion(repo);
    const resultado = await repos.borrarArchivo(sesion, repo, ruta);
    if (!resultado.ok) {
      reply.code(400);
      return { error: resultado.motivo };
    }
    return resultado;
  });

  /** "Confirmar" del control de código: un commit firmado por la persona. */
  // --- Control de versiones (stage, commit, stash, ramas) ----------------------

  /**
   * El estado git de la sesión abierta del repo. Sin sesión no hay nada que
   * preparar ni commitear: mirar el código no abre una.
   */
  app.get("/api/repos/:repoId/scm", async (request, reply) => {
    const { repoId } = request.params as { repoId: string };
    const repo = conRepo(repoId);
    if (!repo) {
      reply.code(404);
      return { error: "No existe el repo." };
    }
    const previa = repos.sesionAbierta(repo.id, repo.companyId);
    // Una sesión vacía de antes, en una `orq/…`, pasa a la rama del proyecto.
    const sesion = previa ? await repos.alinearConLaRamaDelProyecto(previa, repo) : null;
    // Lo que la persona commiteó en su repo desde otro lado aparece solo: se
    // trae en segundo plano (limitado a una vez cada 45 s) y la próxima
    // consulta ya lo muestra. El `.catch` es obligatorio: sin dueño, una
    // promesa rechazada tira el servidor.
    void repos.sincronizarConOrigen(repo).catch((error: unknown) => request.log.warn({ err: error }, "no se pudo sincronizar"));
    if (!sesion) return { sesion: null, estado: null };
    return { sesion, estado: await runtime.scm.estado(sesion, repo), escritor: runtime.titularDeEscritura(repo.id) };
  });

  /** Traer ya lo nuevo del repo de la persona. No toca el worktree: se puede con un agente trabajando. */
  app.post("/api/sesiones/:id/scm/sincronizar", async (request, reply) => {
    const { id } = request.params as { id: string };
    const encontrada = conSesion(id);
    if (!encontrada) {
      reply.code(404);
      return { error: "No existe la sesión." };
    }
    const r = await repos.sincronizarConOrigen(encontrada.repo, true);
    if (!r.ok) reply.code(409);
    return r.ok ? r : { error: r.detalle };
  });

  app.get("/api/sesiones/:id/scm/historial", async (request, reply) => {
    const { id } = request.params as { id: string };
    const q = request.query as { desde?: string; cantidad?: string; rama?: string };
    const encontrada = conSesion(id);
    if (!encontrada || encontrada.sesion.estado !== "abierta") {
      reply.code(404);
      return { error: "No existe la sesión abierta." };
    }
    try {
      return await runtime.scm.historial(encontrada.sesion, encontrada.repo, {
        desde: Number(q.desde ?? 0) || 0,
        cantidad: Number(q.cantidad ?? 60) || 60,
        ...(q.rama ? { rama: q.rama } : {}),
      });
    } catch (error) {
      reply.code(400);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  app.get("/api/sesiones/:id/scm/commit/:sha", async (request, reply) => {
    const { id, sha } = request.params as { id: string; sha: string };
    const encontrada = conSesion(id);
    if (!encontrada || encontrada.sesion.estado !== "abierta") {
      reply.code(404);
      return { error: "No existe la sesión abierta." };
    }
    try {
      return await runtime.scm.archivosDeCommit(encontrada.sesion, encontrada.repo, sha);
    } catch (error) {
      reply.code(400);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  /**
   * Lo que escribe en la sesión espera a que ningún agente esté en su turno
   * —un stash o un cambio de rama le moverían el árbol debajo—; lo que mueve
   * la rama o el árbol entero espera además a que no haya una corrida viva,
   * porque su próximo turno arrancaría sobre otra cosa sin saberlo.
   */
  const operacionScm = (
    ruta: string,
    trabajo: (sesion: SesionCodigo, repo: Repositorio, cuerpo: Record<string, unknown>) => Promise<unknown>,
    opciones: { sinCorrida?: boolean } = {},
  ) =>
    app.post(`/api/sesiones/:id/scm/${ruta}`, async (request, reply) => {
      const { id } = request.params as { id: string };
      const encontrada = conSesion(id);
      if (!encontrada || encontrada.sesion.estado !== "abierta") {
        reply.code(404);
        return { error: "No existe la sesión abierta." };
      }
      const escritor = runtime.titularDeEscritura(encontrada.repo.id);
      if (escritor) {
        reply.code(409);
        return { error: `${escritor} está escribiendo en su turno. Esperá a que termine.` };
      }
      if (opciones.sinCorrida && runtime.tieneCorridaViva(encontrada.repo.companyId)) {
        reply.code(409);
        return { error: "Hay una corrida en curso trabajando sobre esta sesión: cambiarle la rama o el árbol la dejaría trabajando sobre otra cosa. Esperá a que termine o detenela." };
      }
      try {
        const resultado = await trabajo(encontrada.sesion, encontrada.repo, (request.body ?? {}) as Record<string, unknown>);
        return resultado ?? { ok: true };
      } catch (error) {
        reply.code(409);
        return { error: error instanceof Error ? error.message : String(error) };
      }
    });

  const listaDeRutas = (valor: unknown): string[] | "todo" =>
    valor === "todo" ? "todo" : Array.isArray(valor) ? valor.map(String).slice(0, 2_000) : [];
  const texto = (valor: unknown) => (typeof valor === "string" ? valor : "");

  operacionScm("preparar", (sesion, repo, b) => runtime.scm.preparar(sesion, repo, listaDeRutas(b.rutas)));
  operacionScm("quitar", (sesion, repo, b) => runtime.scm.quitar(sesion, repo, listaDeRutas(b.rutas)));
  operacionScm("descartar", (sesion, repo, b) => runtime.scm.descartar(sesion, repo, listaDeRutas(b.rutas)));
  operacionScm("commit", (sesion, repo, b) =>
    runtime.scm.commit(sesion, repo, { mensaje: texto(b.mensaje), todo: b.todo === true, amend: b.amend === true }),
  );
  operacionScm("mensaje", async (sesion, repo) => ({ mensaje: await runtime.generarMensajeDeCommit(sesion, repo) }));
  operacionScm(
    "stash",
    (sesion, repo, b) =>
      runtime.scm.guardarStash(sesion, repo, {
        mensaje: texto(b.mensaje),
        incluirNuevos: b.incluirNuevos !== false,
        soloPreparados: b.soloPreparados === true,
      }),
    { sinCorrida: true },
  );
  operacionScm(
    "stash/usar",
    (sesion, repo, b) => {
      const accion = b.accion === "sacar" || b.accion === "borrar" ? b.accion : "aplicar";
      return runtime.scm.usarStash(sesion, repo, texto(b.ref), accion);
    },
    { sinCorrida: true },
  );
  operacionScm("ramas/crear", (sesion, repo, b) => runtime.scm.crearRama(sesion, repo, texto(b.nombre), texto(b.desde) || undefined), {
    sinCorrida: true,
  });
  operacionScm("ramas/cambiar", (sesion, repo, b) => runtime.scm.cambiarRama(sesion, repo, texto(b.nombre)), { sinCorrida: true });
  operacionScm("ramas/borrar", (sesion, repo, b) => runtime.scm.borrarRama(sesion, repo, texto(b.nombre)));
  operacionScm("ramas/fusionar", (sesion, repo, b) => runtime.scm.fusionar(sesion, repo, texto(b.nombre)), { sinCorrida: true });

  app.post("/api/sesiones/:id/confirmar", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { mensaje } = (request.body ?? {}) as { mensaje?: string };
    const encontrada = conSesion(id);
    if (!encontrada || encontrada.sesion.estado !== "abierta") {
      reply.code(404);
      return { error: "No existe la sesión abierta." };
    }
    if (runtime.titularDeEscritura(encontrada.repo.id)) {
      reply.code(409);
      return { error: "Un agente está escribiendo en su turno. Confirmá cuando termine." };
    }
    const persona = await repos.identidadDePersona();
    const sha = await repos.checkpoint(
      encontrada.sesion,
      encontrada.repo,
      { nombre: persona.nombre, id: "persona", email: persona.email },
      "",
      { titulo: (mensaje ?? "").trim() || "Cambios desde el IDE" },
    );
    return { sha };
  });

  /**
   * La terminal del IDE: sólo lo permitido para el repo, en el sandbox. Una
   * persona que quiere correr otra cosa lo agrega a la lista a sabiendas —o
   * abre su propia terminal—; lo que no puede pasar es que esta API corra lo
   * que le mande cualquier página abierta en el navegador.
   */
  app.post("/api/repos/:repoId/ejecutar", async (request, reply) => {
    const { repoId } = request.params as { repoId: string };
    const { comando, segundos, carpeta } = (request.body ?? {}) as { comando?: string; segundos?: number; carpeta?: string };
    const repo = conRepo(repoId);
    if (!repo) {
      reply.code(404);
      return { error: "No existe el repo." };
    }
    const tokens = tokenizar(comando ?? "");
    if (!tokens.ok) {
      reply.code(400);
      return { error: tokens.motivo };
    }
    if (repo.pendienteDeConfirmar) {
      reply.code(409);
      return { error: "Los comandos de este repo vinieron importados: confirmalos primero en Repositorio." };
    }
    const decision = decidirComando(tokens.argv, { permitidos: repo.comandos.permitidos, unaVez: [] });
    if (!decision.permitido) {
      reply.code(403);
      return {
        error: `"${argvATexto(tokens.argv)}" no está en los comandos permitidos del repo. Agregalo en Repositorio → Comandos si querés que se pueda correr desde acá (y por los agentes).`,
      };
    }
    const corte = Math.max(5, Math.min(600, Number(segundos ?? 300) || 300)) * 1000;
    try {
      return await runtime.ejecutarComoPersona(repo, tokens.argv, corte, carpeta?.trim() || "");
    } catch (error) {
      return fallo(reply, error);
    }
  });

  // --- Chat de IA y vista previa -------------------------------------------------

  /** El agente del chat: se crea con un click, una sola vez por empresa. */
  app.post("/api/companies/:companyId/mejorador", async (request, reply) => {
    const { companyId } = request.params as { companyId: string };
    if (!store.getCompany(companyId)) {
      reply.code(404);
      return { error: "No existe la empresa." };
    }
    try {
      return await runtime.crearMejorador(companyId);
    } catch (error) {
      return fallo(reply, error);
    }
  });

  /** Las corridas enfocadas en un repo: la historia del chat. */
  app.get("/api/repos/:repoId/pedidos", async (request, reply) => {
    const { repoId } = request.params as { repoId: string };
    const repo = conRepo(repoId);
    if (!repo) {
      reply.code(404);
      return { error: "No existe el repo." };
    }
    // Con `conversacion`, sólo esa. `anteriores` son los pedidos de antes de
    // que existieran las conversaciones: se ven juntos, como se veían.
    const { conversacion } = request.query as { conversacion?: string };
    return store
      .listRuns(repo.companyId)
      .filter((run) => run.foco?.repoId === repo.id)
      .filter((run) =>
        !conversacion
          ? true
          : conversacion === "anteriores"
            ? !run.foco?.conversacionId
            : run.foco?.conversacionId === conversacion,
      )
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, 30);
  });

  /** Las conversaciones del chat de un repo, la más reciente primero. */
  app.get("/api/repos/:repoId/conversaciones", async (request, reply) => {
    const { repoId } = request.params as { repoId: string };
    const repo = conRepo(repoId);
    if (!repo) {
      reply.code(404);
      return { error: "No existe el repo." };
    }
    const grupos = new Map<string, { id: string; titulo: string; pedidos: number; desde: number; ultima: number }>();
    const pedidos = store
      .listRuns(repo.companyId)
      .filter((run) => run.foco?.repoId === repo.id)
      .sort((a, b) => a.startedAt - b.startedAt);
    for (const run of pedidos) {
      const id = run.foco?.conversacionId ?? "anteriores";
      const grupo = grupos.get(id);
      if (grupo) {
        grupo.pedidos += 1;
        grupo.ultima = run.startedAt;
      } else {
        grupos.set(id, {
          id,
          titulo: id === "anteriores" ? "Pedidos anteriores" : run.objective.replace(/\s+/g, " ").slice(0, 80),
          pedidos: 1,
          desde: run.startedAt,
          ultima: run.startedAt,
        });
      }
    }
    return [...grupos.values()].sort((a, b) => b.ultima - a.ultima).slice(0, 50);
  });

  /** Lo que cambió un pedido sin commit: la diferencia entre sus dos instantáneas. */
  app.get("/api/sesiones/:id/entre", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { desde, hasta } = request.query as { desde?: string; hasta?: string };
    const encontrada = conSesion(id);
    if (!encontrada) {
      reply.code(404);
      return { error: "No existe la sesión." };
    }
    try {
      return { archivos: await repos.cambiosEntre(encontrada.sesion, encontrada.repo, desde ?? "", hasta ?? "") };
    } catch (error) {
      reply.code(400);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  /** "Deshacer" de un pedido sin commit: su diferencia, aplicada al revés sobre el árbol. */
  app.post("/api/sesiones/:id/deshacer-entre", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { desde, hasta } = (request.body ?? {}) as { desde?: string; hasta?: string };
    const encontrada = conSesion(id);
    if (!encontrada || encontrada.sesion.estado !== "abierta") {
      reply.code(404);
      return { error: "No existe la sesión abierta." };
    }
    const escritor = runtime.titularDeEscritura(encontrada.repo.id);
    if (escritor) {
      reply.code(409);
      return { error: `${escritor} está escribiendo en su turno. Esperá a que termine.` };
    }
    try {
      await repos.deshacerEntre(encontrada.sesion, encontrada.repo, desde ?? "", hasta ?? "");
      return { ok: true };
    } catch (error) {
      reply.code(409);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  /** Ajustes del repo: por ahora, si los agentes commitean al final de cada turno. */
  app.patch("/api/repos/:repoId/ajustes", async (request, reply) => {
    const { repoId } = request.params as { repoId: string };
    const repo = conRepo(repoId);
    if (!repo) {
      reply.code(404);
      return { error: "No existe el repo." };
    }
    const { commitsAutomaticos } = (request.body ?? {}) as { commitsAutomaticos?: unknown };
    return repos.actualizarAjustes(repo, typeof commitsAutomaticos === "boolean" ? { commitsAutomaticos } : {});
  });

  app.get("/api/sesiones/:id/commit/:sha", async (request, reply) => {
    const { id, sha } = request.params as { id: string; sha: string };
    const encontrada = conSesion(id);
    if (!encontrada) {
      reply.code(404);
      return { error: "No existe la sesión." };
    }
    return { archivos: await repos.archivosDeCommit(encontrada.sesion, encontrada.repo, sha) };
  });

  /** "Deshacer" del chat: revierte los checkpoints de un pedido. */
  app.post("/api/sesiones/:id/revertir", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { shas } = (request.body ?? {}) as { shas?: unknown };
    const encontrada = conSesion(id);
    if (!encontrada || encontrada.sesion.estado !== "abierta") {
      reply.code(404);
      return { error: "No existe la sesión abierta." };
    }
    if (!Array.isArray(shas) || shas.length === 0 || !shas.every((sha) => typeof sha === "string")) {
      reply.code(400);
      return { error: "Faltan los checkpoints a deshacer." };
    }
    const escritor = runtime.titularDeEscritura(encontrada.repo.id);
    if (escritor) {
      reply.code(409);
      return { error: `${escritor} está escribiendo en su turno. Deshacé cuando termine.` };
    }
    const resultado = await repos.revertir(
      encontrada.sesion,
      encontrada.repo,
      shas as string[],
      await repos.identidadDePersona(),
    );
    if (!resultado.ok) {
      reply.code(409);
      return { error: resultado.motivo };
    }
    return resultado;
  });

  /**
   * Vista previa: sirve los archivos del worktree (o de la base, sin sesión)
   * para verlos correr en un iframe del IDE.
   *
   * El iframe va con `sandbox="allow-scripts"` **sin** `allow-same-origin`: es
   * código que escribió un agente, y con el mismo origen que la app podría
   * llamar a toda la API —borrar empresas, correr comandos— con sólo cargarse.
   * Con origen opaco, los ES modules necesitan CORS para cargar, y por eso
   * estas respuestas —y sólo éstas— van con `Access-Control-Allow-Origin: *`.
   */
  app.get("/api/repos/:repoId/vista/*", async (request, reply) => {
    const { repoId } = request.params as { repoId: string };
    const pedida = decodeURIComponent((request.params as Record<string, string>)["*"] ?? "") || "index.html";
    const repo = conRepo(repoId);
    if (!repo) {
      reply.code(404);
      return { error: "No existe el repo." };
    }
    let raiz: string;
    try {
      raiz = await realpath(repos.raizDeVista(repo));
    } catch {
      reply.code(404);
      return { error: "El repo no tiene copia de trabajo." };
    }
    let resuelta = await resolverEnWorktree(raiz, pedida);
    if (!resuelta.ok) {
      reply.code(404);
      return { error: resuelta.motivo };
    }
    try {
      if ((await stat(resuelta.absoluta)).isDirectory()) {
        resuelta = await resolverEnWorktree(raiz, join(resuelta.relativa, "index.html"));
        if (!resuelta.ok) throw new Error("sin index");
      }
      const bytes = await readFile(resuelta.absoluta);
      reply
        .header("content-type", tipoWeb(resuelta.relativa))
        // El mismo sandbox que el iframe, pero puesto por el servidor: así
        // también vale si alguien abre la vista en una pestaña aparte, donde
        // ningún atributo `sandbox` la protege y correría con el origen de la
        // app —con acceso a toda la API por el proxy—.
        .header("content-security-policy", "sandbox allow-scripts allow-pointer-lock allow-forms")
        .header("access-control-allow-origin", "*")
        .header("cache-control", "no-store")
        .header("x-content-type-options", "nosniff");
      return reply.send(bytes);
    } catch {
      reply.code(404).header("access-control-allow-origin", "*");
      return { error: `No existe "${pedida}".` };
    }
  });

  app.get("/api/companies/:companyId/codigo/stream", async (request, reply) => {
    const { companyId } = request.params as { companyId: string };
    const stream = openSse(reply);
    const soltar = runtime.subscribeCodigo(companyId, (evento) => stream.send("codigo", evento));
    request.raw.on("close", () => {
      soltar();
      stream.close();
    });
  });
}

/** Tipos de contenido para servir un sitio: sin el de JS, un ES module no carga. */
function tipoWeb(ruta: string): string {
  const ext = ruta.slice(ruta.lastIndexOf(".") + 1).toLowerCase();
  const tipos: Record<string, string> = {
    html: "text/html; charset=utf-8",
    htm: "text/html; charset=utf-8",
    js: "text/javascript; charset=utf-8",
    mjs: "text/javascript; charset=utf-8",
    cjs: "text/javascript; charset=utf-8",
    css: "text/css; charset=utf-8",
    json: "application/json; charset=utf-8",
    map: "application/json; charset=utf-8",
    wasm: "application/wasm",
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    ico: "image/x-icon",
    avif: "image/avif",
    mp4: "video/mp4",
    webm: "video/webm",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    woff: "font/woff",
    woff2: "font/woff2",
    ttf: "font/ttf",
    otf: "font/otf",
    txt: "text/plain; charset=utf-8",
    md: "text/plain; charset=utf-8",
    glsl: "text/plain; charset=utf-8",
    frag: "text/plain; charset=utf-8",
    vert: "text/plain; charset=utf-8",
    xml: "application/xml",
    glb: "model/gltf-binary",
    gltf: "model/gltf+json",
  };
  return tipos[ext] ?? "application/octet-stream";
}
