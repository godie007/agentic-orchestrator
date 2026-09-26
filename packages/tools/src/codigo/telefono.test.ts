import { describe, expect, it } from "vitest";
import { crearHerramientasDeTelefono, HERRAMIENTAS_DE_TELEFONO, type TelefonoStorage } from "./telefono.js";
import type { PasoDeApp } from "./pasos-app.js";
import type { ToolContext } from "../types.js";

/**
 * Las herramientas de QA móvil vistas desde el agente: qué llega al teléfono
 * y qué vuelve. El teléfono es un storage falso; lo de adb se prueba en el
 * servidor.
 */

const ctx = {} as unknown as ToolContext;

function storageFalso(sobre: Partial<TelefonoStorage> = {}) {
  const llamadas: Array<{ metodo: string; args: unknown[] }> = [];
  const registrar =
    (metodo: string, respuesta: unknown) =>
    async (...args: unknown[]) => {
      llamadas.push({ metodo, args });
      return respuesta;
    };
  const storage = {
    explorar: registrar("explorar", { ok: true, texto: "En pantalla (1 elementos, de arriba abajo):\n- «Fotos» (tocable)" }),
    actuar: registrar("actuar", { ok: true, completo: true, bitacora: ["1. tocar_texto «Fotos» → tocado"], pantalla: "- «Visitas»" }),
    ...sobre,
  } as unknown as TelefonoStorage;
  return { storage, llamadas };
}

const herramienta = (storage: TelefonoStorage, nombre: string) => crearHerramientasDeTelefono(storage).find((t) => t.name === nombre)!;

describe("QA móvil para agentes", () => {
  it("las dos herramientas nuevas se registran con las de depuración", () => {
    expect(HERRAMIENTAS_DE_TELEFONO).toEqual(expect.arrayContaining(["explorar_telefono", "manejar_app"]));
    const { storage } = storageFalso();
    const nombres = crearHerramientasDeTelefono(storage).map((t) => t.name);
    expect(nombres).toEqual(expect.arrayContaining(["explorar_telefono", "manejar_app"]));
    expect(herramienta(storage, "explorar_telefono").readOnly).toBe(true);
    expect(herramienta(storage, "manejar_app").readOnly).toBe(false);
  });

  it("explorar_telefono pasa lo buscado, limpio y acotado", async () => {
    const { storage, llamadas } = storageFalso();
    const r = await herramienta(storage, "explorar_telefono").execute({ buscar: [" Fotos ", "", 3, ...Array(20).fill("x")] }, ctx);
    expect(r.ok).toBe(true);
    const buscar = llamadas[0]!.args[1] as string[];
    expect(buscar[0]).toBe("Fotos");
    expect(buscar.length).toBeLessThanOrEqual(10);
    expect(buscar.every((b) => typeof b === "string" && b.trim())).toBe(true);
  });

  it("manejar_app no llega al teléfono con pasos inválidos", async () => {
    const { storage, llamadas } = storageFalso();
    const r = await herramienta(storage, "manejar_app").execute({ pasos: [{ accion: "tocar", x: 0.5, y: 0.5 }] }, ctx);
    expect(r.ok).toBe(false);
    expect(llamadas).toHaveLength(0);
  });

  it("manejar_app manda los pasos validados y devuelve la bitácora y la pantalla resultante", async () => {
    const { storage, llamadas } = storageFalso();
    const r = await herramienta(storage, "manejar_app").execute({ pasos: [{ accion: "tocar_texto", texto: "Fotos" }] }, ctx);
    expect(r.ok).toBe(true);
    expect(llamadas[0]!.args[1] as PasoDeApp[]).toEqual([{ accion: "tocar_texto", texto: "Fotos", n: 1, exacto: false }]);
    expect(r.content).toMatch(/tocado/);
    expect(r.content).toMatch(/Visitas/);
  });

  it("si un paso falla, es un error para el agente pero con lo que se alcanzó a hacer y lo que se ve", async () => {
    const { storage } = storageFalso({
      actuar: async () => ({
        ok: true,
        completo: false,
        bitacora: ["1. tocar_texto «Fotos» → tocado"],
        pantalla: "- «Visitas»",
        fallo: "Paso 2 (tocar_texto «Guardar»): no está en pantalla.",
      }),
    });
    const r = await herramienta(storage, "manejar_app").execute({ pasos: [{ accion: "tocar_texto", texto: "Fotos" }, { accion: "tocar_texto", texto: "Guardar" }] }, ctx);
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/Paso 2/);
    expect(r.content).toMatch(/tocado/);
    expect(r.content).toMatch(/Visitas/);
  });

  it("si el teléfono se niega (producción, app cerrada), el motivo llega tal cual", async () => {
    const { storage } = storageFalso({ actuar: async () => ({ ok: false, motivo: "La app apunta a producción." }) });
    const r = await herramienta(storage, "manejar_app").execute({ pasos: [{ accion: "esperar", segundos: 1 }] }, ctx);
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/producción/);
  });
});
