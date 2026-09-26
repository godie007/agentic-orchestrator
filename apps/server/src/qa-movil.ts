import type { PasoDeApp } from "@orq/tools";
import type { NodoDePantalla } from "./dispositivos.js";

/**
 * QA móvil: un agente que maneja la app del repo en el teléfono de una persona.
 *
 * Todo lo que decide dónde cae un toque vive acá, puro y probado: ubicar lo
 * que el agente nombró en el árbol de la pantalla de ese momento, no tocar
 * nunca las barras del sistema, frenar si la app dejó de estar al frente y no
 * dejar que se maneje una app que apunta a producción. `depuracion-movil.ts`
 * sólo le conecta el teléfono de verdad.
 */

/** La franja vertical de la app: arriba la barra de estado, abajo la de navegación del sistema. */
const ZONA_UTIL = { arriba: 0.03, abajo: 0.94 } as const;
const TOPE_RESUMEN = 4_000;
const PAUSA_ENTRE_PASOS_MS = 400;
const INTERVALO_ESPERA_MS = 700;

const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const etiquetaDe = (n: NodoDePantalla) => n.texto || n.descripcion;
const centro = (n: NodoDePantalla) => ({ x: n.x + n.ancho / 2, y: n.y + n.alto / 2 });
const enZonaUtil = (n: NodoDePantalla) => {
  const { y } = centro(n);
  return y >= ZONA_UTIL.arriba && y <= ZONA_UTIL.abajo;
};
const enOrdenDeLectura = (a: NodoDePantalla, b: NodoDePantalla) => a.y - b.y || a.x - b.x;

function coincide(n: NodoDePantalla, buscado: string, exacto: boolean): boolean {
  const aguja = normalizar(buscado);
  return [n.texto, n.descripcion, n.recurso].some((campo) => {
    const valor = normalizar(campo);
    return valor !== "" && (exacto ? valor === aguja : valor.includes(aguja));
  });
}

export function ubicarNodo(
  nodos: NodoDePantalla[],
  objetivo: { texto: string; n: number; exacto: boolean },
): { ok: true; nodo: NodoDePantalla; x: number; y: number; total: number } | { ok: false; total: number } {
  const candidatos = nodos.filter((n) => n.ancho > 0 && n.alto > 0 && enZonaUtil(n) && coincide(n, objetivo.texto, objetivo.exacto)).sort(enOrdenDeLectura);
  const elegido = candidatos[objetivo.n - 1];
  if (!elegido) return { ok: false, total: candidatos.length };
  return { ok: true, nodo: elegido, ...centro(elegido), total: candidatos.length };
}

/**
 * La pantalla en texto: lo que un agente necesita para decidir el próximo
 * toque, sin mandarle una imagen. En orden de lectura, sin la barra del
 * sistema, y con tope.
 */
export function resumirPantalla(nodos: NodoDePantalla[], opciones: { buscar?: string[] } = {}): string {
  const visibles = nodos.filter((n) => enZonaUtil(n) && n.ancho > 0 && n.alto > 0).sort(enOrdenDeLectura);
  const cabecera = (opciones.buscar ?? []).map((b) => {
    const cuantos = visibles.filter((n) => coincide(n, b, false)).length;
    return cuantos ? `Buscado «${b}»: visible (${cuantos})` : `Buscado «${b}»: no está en pantalla`;
  });
  const vistas = new Set<string>();
  const cuerpo: string[] = [];
  for (const n of visibles) {
    const etiqueta = etiquetaDe(n);
    if (!etiqueta && !(n.pulsable && n.recurso)) continue;
    const linea = `- ${etiqueta ? `«${etiqueta}»` : "(sin texto)"}${n.pulsable ? " (tocable)" : ""}${n.recurso ? ` #${n.recurso}` : ""}`;
    if (vistas.has(linea)) continue;
    vistas.add(linea);
    cuerpo.push(linea);
  }
  const lineas = [...cabecera, `En pantalla (${cuerpo.length} elementos, de arriba abajo):`];
  let largo = lineas.join("\n").length;
  for (const [i, l] of cuerpo.entries()) {
    if (largo + l.length + 1 > TOPE_RESUMEN) {
      lineas.push(`(…y ${cuerpo.length - i} elementos más: deslizá o buscá uno puntual)`);
      break;
    }
    lineas.push(l);
    largo += l.length + 1;
  }
  return lineas.join("\n");
}

const DECLARA_ENTORNO = /(^|_)(APP_|NODE_)?ENV(IRONMENT)?$/i;

/**
 * Si el entorno de la app la apunta a producción: por los marcadores que la
 * persona configuró en el servicio (la ref del proyecto de producción, su
 * dominio) o por una variable que lo declara. Devuelve sólo los nombres de las
 * variables, nunca sus valores.
 */
export function detectarProduccion(
  variables: Record<string, string>,
  marcadores: string[],
): { produccion: false } | { produccion: true; variables: string[] } {
  const utiles = marcadores.map((m) => m.trim().toLowerCase()).filter((m) => m.length >= 5);
  const culpables = Object.entries(variables)
    .filter(
      ([nombre, valor]) =>
        utiles.some((m) => valor.toLowerCase().includes(m)) || (DECLARA_ENTORNO.test(nombre) && /^(prod|production)$/i.test(valor.trim())),
    )
    .map(([nombre]) => nombre)
    .sort();
  return culpables.length ? { produccion: true, variables: culpables } : { produccion: false };
}

/** El teléfono tal como lo ve la ejecución de pasos: `depuracion-movil.ts` lo conecta a `Dispositivos`. */
export interface PuertosDeApp {
  enFrente(): Promise<boolean>;
  arbol(): Promise<NodoDePantalla[]>;
  tocar(x: number, y: number): Promise<void>;
  escribir(texto: string): Promise<{ omitidos: boolean }>;
  tecla(tecla: "atras" | "enter" | "tab" | "borrar"): Promise<void>;
  deslizar(desde: { x: number; y: number }, hasta: { x: number; y: number }, ms: number): Promise<void>;
  dormir(ms: number): Promise<void>;
}

/** «abajo» es ver lo que está más abajo: el dedo va hacia arriba. */
const DESLIZAR = {
  abajo: [{ x: 0.5, y: 0.7 }, { x: 0.5, y: 0.3 }],
  arriba: [{ x: 0.5, y: 0.3 }, { x: 0.5, y: 0.7 }],
  derecha: [{ x: 0.8, y: 0.5 }, { x: 0.2, y: 0.5 }],
  izquierda: [{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }],
} as const;

const describir = (p: PasoDeApp) =>
  p.accion === "tocar_texto" || p.accion === "esperar_texto"
    ? `${p.accion} «${p.texto}»${p.accion === "tocar_texto" && p.n > 1 ? ` (n=${p.n})` : ""}`
    : p.accion === "escribir"
      ? `escribir (${p.texto.length} caracteres)`
      : p.accion === "tecla"
        ? `tecla ${p.tecla}`
        : p.accion === "deslizar"
          ? `deslizar ${p.direccion}`
          : `esperar ${p.segundos} s`;

/** Las etiquetas visibles en una línea, para decir qué había cuando algo no se encontró. */
const queSeVe = (nodos: NodoDePantalla[]) => {
  const etiquetas = [...new Set(nodos.filter(enZonaUtil).sort(enOrdenDeLectura).map(etiquetaDe).filter(Boolean))];
  return etiquetas.length ? etiquetas.slice(0, 25).map((e) => `«${e}»`).join(", ") + (etiquetas.length > 25 ? ", …" : "") : "(nada con texto)";
};

export async function ejecutarPasos(
  pasos: PasoDeApp[],
  puertos: PuertosDeApp,
): Promise<{ ok: boolean; bitacora: string[]; pantalla: string; fallo?: string }> {
  const bitacora: string[] = [];
  let ultima: NodoDePantalla[] | null = null;
  const leer = async () => (ultima = await puertos.arbol());
  const cortar = async (i: number, p: PasoDeApp, motivo: string) => {
    const nodos = ultima ?? (await leer());
    return { ok: false, bitacora, pantalla: resumirPantalla(nodos), fallo: `Paso ${i + 1} (${describir(p)}): ${motivo}` };
  };

  for (const [i, p] of pasos.entries()) {
    const toca = p.accion === "tocar_texto" || p.accion === "escribir" || p.accion === "tecla" || p.accion === "deslizar";
    // Antes de cada toque: si la app ya no está al frente, lo que hay debajo del dedo es de la persona.
    if (toca && !(await puertos.enFrente())) {
      return cortar(i, p, "la app ya no está en primer plano; no se toca nada fuera de ella. Revisá con estado_de_la_app o reiniciar_app.");
    }
    switch (p.accion) {
      case "tocar_texto": {
        let r = ubicarNodo(await leer(), p);
        // Una transición a medias: se le da un momento antes de declararlo ausente.
        if (!r.ok) {
          await puertos.dormir(800);
          r = ubicarNodo(await leer(), p);
        }
        if (!r.ok) {
          const cuenta = r.total ? `hay ${r.total} y pediste la ${p.n}` : "no está en pantalla";
          return cortar(i, p, `${cuenta}. Se ve: ${queSeVe(ultima ?? [])}.`);
        }
        await puertos.tocar(r.x, r.y);
        bitacora.push(`${i + 1}. ${describir(p)} → tocado${r.total > 1 ? ` (había ${r.total})` : ""}`);
        break;
      }
      case "esperar_texto": {
        const vueltas = Math.max(1, Math.ceil((p.segundos * 1000) / INTERVALO_ESPERA_MS));
        let anterior: number | null = null;
        let quieto = false;
        for (let k = 0; k < vueltas && !quieto; k++) {
          const r = ubicarNodo(await leer(), { texto: p.texto, n: 1, exacto: p.exacto });
          // Visible en dos lecturas seguidas en el mismo lugar: ya no se está moviendo.
          if (r.ok && anterior != null && Math.abs(r.y - anterior) < 0.005) quieto = true;
          else {
            anterior = r.ok ? r.y : null;
            await puertos.dormir(INTERVALO_ESPERA_MS);
          }
        }
        if (!quieto) return cortar(i, p, `«${p.texto}» no apareció (o no se quedó quieto) en ${p.segundos} s. Se ve: ${queSeVe(ultima ?? [])}.`);
        bitacora.push(`${i + 1}. ${describir(p)} → visible`);
        break;
      }
      case "escribir": {
        const { omitidos } = await puertos.escribir(p.texto);
        bitacora.push(
          `${i + 1}. ${describir(p)} → escrito${omitidos ? " (se omitieron caracteres no ASCII: sin el espejo abierto, adb sólo escribe ASCII; verificá el campo)" : ""}`,
        );
        break;
      }
      case "tecla":
        await puertos.tecla(p.tecla);
        bitacora.push(`${i + 1}. ${describir(p)}`);
        break;
      case "deslizar": {
        const [desde, hasta] = DESLIZAR[p.direccion];
        await puertos.deslizar(desde, hasta, 350);
        bitacora.push(`${i + 1}. ${describir(p)}`);
        break;
      }
      case "esperar":
        await puertos.dormir(p.segundos * 1000);
        bitacora.push(`${i + 1}. ${describir(p)}`);
        break;
    }
    ultima = null;
    await puertos.dormir(PAUSA_ENTRE_PASOS_MS);
  }
  return { ok: true, bitacora, pantalla: resumirPantalla(await leer()) };
}
