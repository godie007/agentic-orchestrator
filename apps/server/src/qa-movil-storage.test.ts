import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Repositorio } from "@orq/shared";
import { crearTelefonoStorage } from "./depuracion-movil.js";
import type { Dispositivos, NodoDePantalla } from "./dispositivos.js";

/**
 * explorar_telefono y manejar_app contra un teléfono falso: lo que se fija es
 * cuándo el servidor se niega antes de tocar nada.
 */

const APP = "co.codla.inspia";
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "qa-movil-"));
  await mkdir(join(dir, "mobile"), { recursive: true });
  await writeFile(join(dir, "mobile", "app.json"), JSON.stringify({ expo: { android: { package: APP } } }));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const FOTOS: NodoDePantalla = { id: 0, padre: null, clase: "TextView", texto: "Fotos", descripcion: "", recurso: "", pulsable: true, x: 0.1, y: 0.2, ancho: 0.8, alto: 0.04 };

function escenario(opciones: { env?: string; marcadores?: string[]; alFrente?: string; despierta?: boolean } = {}) {
  const tocado: string[] = [];
  const arboles: string[] = [];
  const dispositivos = {
    telefonoPara: async () => ({ ok: true, serial: "S1" }),
    adbTexto: async (_serial: string, args: string[]) => {
      const cmd = args.join(" ");
      if (cmd.includes("dumpsys activity activities")) return { codigo: 0, salida: `  topResumedActivity=ActivityRecord{1 u0 ${opciones.alFrente ?? APP}/.MainActivity t9}` };
      if (cmd.includes("dumpsys power")) return { codigo: 0, salida: `mWakefulness=${opciones.despierta === false ? "Asleep" : "Awake"}` };
      return { codigo: 0, salida: "" };
    },
    arbol: async () => (arboles.push("arbol"), { ancho: 1080, alto: 2400, nodos: [FOTOS] }),
    tocar: async (_s: string, x: number, y: number) => void tocado.push(`tocar ${x.toFixed(2)},${y.toFixed(2)}`),
    escribir: async (_s: string, t: string) => (tocado.push(`escribir ${t}`), { omitidos: false }),
    tecla: async (_s: string, t: string) => void tocado.push(`tecla ${t}`),
    deslizar: async () => void tocado.push("deslizar"),
  } as unknown as Dispositivos;

  const envPath = join(dir, "mobile", ".env");
  const servicio = {
    id: "mobile",
    nombre: "Mobile",
    carpeta: "mobile",
    tipo: "movil",
    arrancar: null,
    variablePuerto: null,
    puertoOriginal: null,
    salud: null,
    inicio: "/",
    archivosEntorno: [envPath],
    entorno: {},
    marcadoresProduccion: opciones.marcadores ?? ["qnfeqicedlysxredgzid"],
  };
  const repo = { id: "repo_1", nombre: "inspia", servicios: [servicio] } as unknown as Repositorio;
  const storage = crearTelefonoStorage({
    dispositivos,
    tmp: dir,
    resolverRepo: () => ({ ok: true, repo, worktree: dir }),
    guardarEnSalida: async () => "revision/x.png",
    metroDe: () => null,
    reabrir: async () => {},
    dormir: async () => {},
  });
  return { storage, tocado, arboles, envPath, escribirEnv: (t: string) => writeFile(envPath, t) };
}

describe("QA móvil en el servidor", () => {
  it("maneja la app de staging: ubica «Fotos» y toca su centro", async () => {
    const e = escenario();
    await e.escribirEnv("EXPO_PUBLIC_SUPABASE_URL=https://vrmbrxxcvxeaflsgtyfa.supabase.co\n");
    const r = await e.storage.actuar(undefined, [{ accion: "tocar_texto", texto: "Fotos", n: 1, exacto: false }]);
    expect(r.ok && r.completo).toBe(true);
    expect(e.tocado).toEqual(["tocar 0.50,0.22"]);
  });

  it("se niega a manejar una app que apunta a producción, sin tocar nada ni decir el valor", async () => {
    const e = escenario();
    await e.escribirEnv("EXPO_PUBLIC_SUPABASE_URL=https://qnfeqicedlysxredgzid.supabase.co\n");
    const r = await e.storage.actuar(undefined, [{ accion: "tocar_texto", texto: "Fotos", n: 1, exacto: false }]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toMatch(/producci[oó]n/);
      expect(r.motivo).toMatch(/EXPO_PUBLIC_SUPABASE_URL/);
      expect(r.motivo).not.toMatch(/qnfeqic/);
    }
    expect(e.tocado).toEqual([]);
    expect(e.arboles).toEqual([]);
  });

  it("explorar una app de producción sí se puede: sólo mira", async () => {
    const e = escenario();
    await e.escribirEnv("EXPO_PUBLIC_SUPABASE_URL=https://qnfeqicedlysxredgzid.supabase.co\n");
    const r = await e.storage.explorar(undefined, ["Fotos"]);
    expect(r.ok && r.texto).toMatch(/«Fotos».*visible/);
  });

  it("con otra app al frente no mira ni toca: el resto del teléfono es de la persona", async () => {
    const e = escenario({ alFrente: "com.whatsapp" });
    await e.escribirEnv("");
    expect((await e.storage.explorar(undefined, [])).ok).toBe(false);
    expect((await e.storage.actuar(undefined, [{ accion: "tecla", tecla: "atras" }])).ok).toBe(false);
    expect(e.arboles).toEqual([]);
    expect(e.tocado).toEqual([]);
  });

  it("con la pantalla apagada tampoco", async () => {
    const e = escenario({ despierta: false });
    await e.escribirEnv("");
    const r = await e.storage.actuar(undefined, [{ accion: "tecla", tecla: "atras" }]);
    expect(r.ok).toBe(false);
    expect(e.tocado).toEqual([]);
  });
});
