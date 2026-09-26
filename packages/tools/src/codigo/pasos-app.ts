/**
 * Los pasos con los que un agente maneja la app móvil del repo en el teléfono.
 *
 * **Por texto, no por coordenadas.** Un toque en (540, 1200) no dice qué se
 * quiso tocar: si la pantalla se corrió (un banner de «Sin conexión», el
 * teclado), el mismo número cae en otro botón o, peor, afuera de la app. Acá se
 * nombra lo que se toca y el servidor lo ubica en el árbol de la pantalla en
 * ese momento; si no está, el paso falla con lo que sí se ve. Tampoco hay
 * esperas ni textos sin tope: el teléfono es de una persona.
 */

export type TeclaDeApp = "atras" | "enter" | "tab" | "borrar";
export type DireccionDeslizar = "arriba" | "abajo" | "izquierda" | "derecha";

export type PasoDeApp =
  | { accion: "tocar_texto"; texto: string; n: number; exacto: boolean }
  | { accion: "esperar_texto"; texto: string; segundos: number; exacto: boolean }
  | { accion: "escribir"; texto: string }
  | { accion: "tecla"; tecla: TeclaDeApp }
  | { accion: "deslizar"; direccion: DireccionDeslizar }
  | { accion: "esperar"; segundos: number };

export const MAX_PASOS = 20;
const MAX_TEXTO_BUSCADO = 120;
const MAX_TEXTO_ESCRITO = 500;
const TECLAS: readonly TeclaDeApp[] = ["atras", "enter", "tab", "borrar"];
const DIRECCIONES: readonly DireccionDeslizar[] = ["arriba", "abajo", "izquierda", "derecha"];

const entre = (v: unknown, min: number, max: number, porDefecto: number) => {
  const n = Number(v ?? porDefecto);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : porDefecto;
};

function textoBuscado(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t && t.length <= MAX_TEXTO_BUSCADO ? t : null;
}

function validarPaso(raw: unknown): PasoDeApp | string {
  if (!raw || typeof raw !== "object") return "no es un objeto";
  const p = raw as Record<string, unknown>;
  switch (p.accion) {
    case "tocar_texto": {
      const texto = textoBuscado(p.texto);
      if (!texto) return `«texto» vacío o de más de ${MAX_TEXTO_BUSCADO} caracteres`;
      return { accion: "tocar_texto", texto, n: entre(p.n, 1, 20, 1), exacto: p.exacto === true };
    }
    case "esperar_texto": {
      const texto = textoBuscado(p.texto);
      if (!texto) return `«texto» vacío o de más de ${MAX_TEXTO_BUSCADO} caracteres`;
      return { accion: "esperar_texto", texto, segundos: entre(p.segundos, 1, 30, 10), exacto: p.exacto === true };
    }
    case "escribir": {
      if (typeof p.texto !== "string" || !p.texto) return "«texto» vacío";
      if (p.texto.length > MAX_TEXTO_ESCRITO) return `el texto supera ${MAX_TEXTO_ESCRITO} caracteres`;
      // Un salto de línea en un campo de una línea es un «enter»: que se pida como tecla.
      if (/[\r\n]/.test(p.texto)) return "sin saltos de línea: usá { accion: 'tecla', tecla: 'enter' }";
      return { accion: "escribir", texto: p.texto };
    }
    case "tecla": {
      const tecla = TECLAS.find((t) => t === p.tecla);
      return tecla ? { accion: "tecla", tecla } : `tecla desconocida (usá ${TECLAS.join(", ")})`;
    }
    case "deslizar": {
      const direccion = DIRECCIONES.find((d) => d === p.direccion);
      return direccion ? { accion: "deslizar", direccion } : `dirección desconocida (usá ${DIRECCIONES.join(", ")})`;
    }
    case "esperar":
      return { accion: "esperar", segundos: entre(p.segundos, 1, 10, 1) };
    default:
      return `acción desconocida «${String(p.accion)}» (no hay toques por coordenadas: nombrá lo que querés tocar con tocar_texto)`;
  }
}

export function validarPasos(raw: unknown): { ok: true; pasos: PasoDeApp[] } | { ok: false; motivo: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, motivo: "«pasos» tiene que ser una lista con al menos un paso." };
  if (raw.length > MAX_PASOS) return { ok: false, motivo: `Máximo ${MAX_PASOS} pasos por llamada: partilo en tramos y verificá entre uno y otro.` };
  const pasos: PasoDeApp[] = [];
  for (const [i, crudo] of raw.entries()) {
    const r = validarPaso(crudo);
    if (typeof r === "string") return { ok: false, motivo: `Paso ${i + 1}: ${r}.` };
    pasos.push(r);
  }
  return { ok: true, pasos };
}
