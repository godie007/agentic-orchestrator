import { describe, expect, it } from "vitest";
import type { PasoDeApp } from "@orq/tools";
import type { NodoDePantalla } from "./dispositivos.js";
import { detectarProduccion, ejecutarPasos, resumirPantalla, ubicarNodo, type PuertosDeApp } from "./qa-movil.js";

/**
 * Un agente que maneja la app del teléfono de una persona. Lo que se prueba
 * acá es lo que evita que un toque caiga donde no debía: afuera de la app, en
 * la barra del sistema, en el botón que se corrió, o sobre producción.
 */

let siguienteId = 0;
function nodo(etiqueta: string, y: number, extra: Partial<NodoDePantalla> = {}): NodoDePantalla {
  return { id: siguienteId++, padre: null, clase: "TextView", texto: etiqueta, descripcion: "", recurso: "", pulsable: false, x: 0.1, y, ancho: 0.8, alto: 0.04, ...extra };
}

describe("ubicar lo que se nombra", () => {
  const pantalla = [
    nodo("Fotos", 0.2, { pulsable: true }),
    nodo("Fotos del proyecto", 0.3),
    nodo("", 0.5, { descripcion: "Página siguiente", pulsable: true }),
    nodo("Fotos", 0.6, { pulsable: true }),
    // Barra de navegación del sistema: nunca se toca.
    nodo("Fotos", 0.97, { pulsable: true }),
  ];

  it("por texto o por descripción de accesibilidad, sin distinguir mayúsculas ni tildes", () => {
    const r = ubicarNodo(pantalla, { texto: "pagina SIGUIENTE", n: 1, exacto: false });
    expect(r.ok && r.nodo.descripcion).toBe("Página siguiente");
    if (r.ok) expect(r.y).toBeCloseTo(0.52);
  });

  it("con exacto no confunde «Fotos» con «Fotos del proyecto», y n elige la aparición en orden de lectura", () => {
    const r = ubicarNodo(pantalla, { texto: "Fotos", n: 2, exacto: true });
    expect(r.ok && r.y).toBeCloseTo(0.62);
    expect(ubicarNodo(pantalla, { texto: "fotos", n: 1, exacto: false }).ok).toBe(true);
    const tercero = ubicarNodo(pantalla, { texto: "Fotos", n: 3, exacto: true });
    // La tercera «Fotos» está en la barra del sistema: no cuenta.
    expect(tercero).toMatchObject({ ok: false, total: 2 });
  });

  it("si no está, dice cuántas hay para que el agente no insista a ciegas", () => {
    expect(ubicarNodo(pantalla, { texto: "Guardar", n: 1, exacto: false })).toMatchObject({ ok: false, total: 0 });
  });
});

describe("resumen de la pantalla", () => {
  it("en orden de lectura, marca lo tocable y lo buscado, y deja afuera la barra del sistema", () => {
    const texto = resumirPantalla(
      [nodo("Guardar", 0.8, { pulsable: true }), nodo("Visitas", 0.1), nodo("", 0.4, { descripcion: "Página siguiente", pulsable: true, recurso: "pager-next" }), nodo("Inicio", 0.98, { pulsable: true })],
      { buscar: ["Guardar", "Eliminar"] },
    );
    const lineas = texto.split("\n");
    expect(lineas[0]).toMatch(/«Guardar».*visible/);
    expect(lineas[1]).toMatch(/«Eliminar».*no/);
    const cuerpo = lineas.slice(2).join("\n");
    expect(cuerpo.indexOf("Visitas")).toBeLessThan(cuerpo.indexOf("Página siguiente"));
    expect(cuerpo).toMatch(/«Página siguiente» \(tocable\) #pager-next/);
    expect(cuerpo).not.toMatch(/Inicio/);
  });

  it("tiene tope: una lista larga no llena el contexto del agente", () => {
    const muchos = Array.from({ length: 800 }, (_, i) => nodo(`Fila número ${i} con un texto bastante largo`, 0.05 + (i / 800) * 0.85));
    expect(resumirPantalla(muchos).length).toBeLessThanOrEqual(4_200);
  });
});

describe("¿la app apunta a producción?", () => {
  it("por un marcador configurado en el servicio, sin devolver el valor", () => {
    const r = detectarProduccion(
      { EXPO_PUBLIC_API_URL: "https://inspia.codla.co/api", EXPO_PUBLIC_SUPABASE_URL: "https://qnfeqicedlysxredgzid.supabase.co" },
      ["qnfeqicedlysxredgzid"],
    );
    expect(r).toEqual({ produccion: true, variables: ["EXPO_PUBLIC_SUPABASE_URL"] });
    expect(JSON.stringify(r)).not.toContain("qnfeqic");
  });

  it("por una variable de entorno que lo declara", () => {
    expect(detectarProduccion({ APP_ENV: "production" }, []).produccion).toBe(true);
    expect(detectarProduccion({ EXPO_PUBLIC_ENV: "prod" }, []).produccion).toBe(true);
    expect(detectarProduccion({ EXPO_PUBLIC_ENV: "staging", EXPO_PUBLIC_API_URL: "https://inspia-staging.codla.co/api" }, ["qnfeqic"]).produccion).toBe(false);
  });

  it("un marcador demasiado corto no cuenta (casaría con cualquier cosa)", () => {
    expect(detectarProduccion({ URL: "https://a.co" }, ["co", " "]).produccion).toBe(false);
  });
});

function telefonoFalso(pantallas: NodoDePantalla[][], opciones: { enFrente?: boolean[] } = {}) {
  const hechos: string[] = [];
  let lecturas = 0;
  let frente = 0;
  const puertos: PuertosDeApp = {
    enFrente: async () => opciones.enFrente?.[frente++] ?? true,
    arbol: async () => pantallas[Math.min(lecturas++, pantallas.length - 1)]!,
    tocar: async (x, y) => void hechos.push(`tocar ${x.toFixed(2)},${y.toFixed(2)}`),
    escribir: async (t) => (hechos.push(`escribir ${t}`), { omitidos: /[^\x20-\x7E]/.test(t) }),
    tecla: async (t) => void hechos.push(`tecla ${t}`),
    deslizar: async (d, h) => void hechos.push(`deslizar ${d.y}->${h.y}`),
    dormir: async () => {},
  };
  return { puertos, hechos };
}

describe("ejecutar los pasos", () => {
  const inicio = [nodo("Fotos", 0.2, { pulsable: true }), nodo("Buscar", 0.1, { pulsable: true })];

  it("toca en el centro de lo nombrado, escribe y termina con la pantalla resultante", async () => {
    // Lecturas: la del toque y la final (escribir y la tecla no miran la pantalla).
    const { puertos, hechos } = telefonoFalso([inicio, [nodo("Carpeta QA", 0.3)]]);
    const pasos: PasoDeApp[] = [
      { accion: "tocar_texto", texto: "Buscar", n: 1, exacto: false },
      { accion: "escribir", texto: "QA" },
      { accion: "tecla", tecla: "enter" },
    ];
    const r = await ejecutarPasos(pasos, puertos);
    expect(r.ok).toBe(true);
    expect(hechos).toEqual(["tocar 0.50,0.12", "escribir QA", "tecla enter"]);
    expect(r.bitacora).toHaveLength(3);
    expect(r.pantalla).toMatch(/Carpeta QA/);
  });

  it("si lo nombrado no está, se detiene ahí y cuenta lo que sí se ve (no sigue tocando)", async () => {
    const { puertos, hechos } = telefonoFalso([inicio]);
    const r = await ejecutarPasos(
      [
        { accion: "tocar_texto", texto: "Guardar", n: 1, exacto: false },
        { accion: "tecla", tecla: "atras" },
      ],
      puertos,
    );
    expect(r.ok).toBe(false);
    expect(r.fallo).toMatch(/paso 1/i);
    expect(r.fallo).toMatch(/Guardar/);
    expect(r.pantalla).toMatch(/Fotos/);
    expect(hechos).toEqual([]);
  });

  it("si la app deja de estar al frente, no toca nada más: el resto del teléfono es de la persona", async () => {
    const { puertos, hechos } = telefonoFalso([inicio], { enFrente: [true, false] });
    const r = await ejecutarPasos(
      [
        { accion: "tocar_texto", texto: "Fotos", n: 1, exacto: false },
        { accion: "tocar_texto", texto: "Buscar", n: 1, exacto: false },
      ],
      puertos,
    );
    expect(r.ok).toBe(false);
    expect(r.fallo).toMatch(/primer plano/);
    expect(hechos).toEqual(["tocar 0.50,0.22"]);
  });

  it("esperar_texto espera a que aparezca y quede quieto", async () => {
    const moviendose = (y: number) => [nodo("Subida", y)];
    const { puertos } = telefonoFalso([[], moviendose(0.5), moviendose(0.4), moviendose(0.4)]);
    const r = await ejecutarPasos([{ accion: "esperar_texto", texto: "Subida", segundos: 10, exacto: false }], puertos);
    expect(r.ok).toBe(true);
  });

  it("esperar_texto que no llega falla con tiempo acotado", async () => {
    const { puertos } = telefonoFalso([inicio]);
    const r = await ejecutarPasos([{ accion: "esperar_texto", texto: "Subida", segundos: 2, exacto: false }], puertos);
    expect(r.ok).toBe(false);
    expect(r.fallo).toMatch(/Subida/);
  });

  it("avisa si se omitieron tildes al escribir (sin espejo, adb sólo escribe ASCII)", async () => {
    const { puertos } = telefonoFalso([inicio]);
    const r = await ejecutarPasos([{ accion: "escribir", texto: "Revisión" }], puertos);
    expect(r.ok).toBe(true);
    expect(r.bitacora[0]).toMatch(/omit/i);
  });

  it("deslizar «abajo» es ver lo de más abajo: el dedo sube", async () => {
    const { puertos, hechos } = telefonoFalso([inicio]);
    await ejecutarPasos([{ accion: "deslizar", direccion: "abajo" }], puertos);
    expect(hechos).toEqual(["deslizar 0.7->0.3"]);
  });
});
