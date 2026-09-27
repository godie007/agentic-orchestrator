import { fail, ok, type RegisteredTool } from "../types.js";
import type { Resultado } from "./telefono.js";

/**
 * Leer el bucket de R2 (Cloudflare) del proyecto para verificar lo que la app
 * dice haber subido. `packages/tools` no sabe de credenciales ni de S3: el
 * servidor inyecta el `R2Storage`, que lee las llaves del `.env` del servicio y
 * no las devuelve nunca.
 */
export interface R2Storage {
  listar(
    repoId: string | undefined,
    pedido: { prefijo: string; limite: number; carpetas: boolean; desde?: string },
  ): Promise<Resultado<{ texto: string }>>;
  objetos(repoId: string | undefined, claves: string[], opciones: { guardar: boolean }): Promise<Resultado<{ texto: string }>>;
}

export const HERRAMIENTAS_DE_R2 = ["r2_listar", "r2_objetos"] as const;

const REPO = { repo: { type: "string", description: "Nombre o id del repo. Opcional: se usa el servicio que tiene R2 configurado." } } as const;
const repoDe = (args: Record<string, unknown>) => (typeof args.repo === "string" && args.repo.trim() ? args.repo.trim() : undefined);
/** Una clave de objeto, como la guarda la base: sin barra inicial. */
const limpiarClave = (c: string) => c.trim().replace(/^\/+/, "");

export function crearHerramientasDeR2(storage: R2Storage): RegisteredTool[] {
  const listar: RegisteredTool = {
    name: "r2_listar",
    description:
      "Lista los archivos del bucket de R2 (Cloudflare) del proyecto bajo un prefijo: clave, tamaño y fecha de subida, y marca los vacíos. Con carpetas=true muestra sólo el primer nivel (como un explorador) — úsalo para orientarte antes de bajar. Sólo lectura, sólo staging.",
    inputSchema: {
      type: "object",
      properties: {
        prefijo: { type: "string", description: "Ej. 'projects/<id>/photos/'. Vacío = raíz del bucket." },
        carpetas: { type: "boolean", description: "Agrupa por '/' y muestra las subcarpetas en vez de todo el árbol." },
        limite: { type: "number", description: "Cuántos objetos (1-200, default 50)." },
        desde: { type: "string", description: "El token que devolvió la llamada anterior para seguir listando." },
        ...REPO,
      },
      additionalProperties: false,
    },
    origin: "skill",
    readOnly: true,
    requiresApproval: false,
    async execute(args) {
      const limite = Math.min(200, Math.max(1, Math.floor(Number(args.limite ?? 50)) || 50));
      const r = await storage.listar(repoDe(args), {
        prefijo: typeof args.prefijo === "string" ? limpiarClave(args.prefijo) : "",
        limite,
        carpetas: args.carpetas === true,
        ...(typeof args.desde === "string" && args.desde ? { desde: args.desde } : {}),
      });
      return r.ok ? ok(r.texto) : fail(r.motivo);
    },
  };

  const objetos: RegisteredTool = {
    name: "r2_objetos",
    description:
      "Verifica archivos concretos del bucket de R2 por su clave (la que guarda la base, ej. storage_key): si existen, tamaño, tipo declarado, tipo REAL por sus primeros bytes (avisa si no coinciden o si está vacío), fecha y metadatos. Hasta 20 claves por llamada: verificá un lote entero de una vez. Con guardar=true descarga hasta 5 a la salida (revision/r2/) para que los abras y mires. Sólo lectura, sólo staging.",
    inputSchema: {
      type: "object",
      properties: {
        claves: { type: "array", items: { type: "string" }, description: "Claves de objeto (hasta 20)." },
        guardar: { type: "boolean", description: "Descargarlos a revision/r2/ para mirarlos (hasta 5, 25 MB c/u)." },
        ...REPO,
      },
      required: ["claves"],
      additionalProperties: false,
    },
    origin: "skill",
    readOnly: false,
    requiresApproval: false,
    async execute(args) {
      const claves = (Array.isArray(args.claves) ? args.claves : [])
        .filter((c): c is string => typeof c === "string" && c.trim() !== "")
        .map(limpiarClave);
      if (claves.length === 0) return fail("Pasá al menos una clave en «claves».");
      if (claves.length > 20) return fail(`Son ${claves.length} claves: hasta 20 por llamada.`);
      const r = await storage.objetos(repoDe(args), [...new Set(claves)], { guardar: args.guardar === true });
      return r.ok ? ok(r.texto) : fail(r.motivo);
    },
  };

  return [listar, objetos];
}
