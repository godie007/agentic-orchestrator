import { describe, expect, it } from "vitest";
import { MAX_PASOS, validarPasos } from "./pasos-app.js";

/**
 * Lo que un agente puede pedirle a la app del teléfono de una persona. Cada
 * rechazo de acá es algo que un `input` libre permitía: tocar coordenadas a
 * ciegas, escribir un comando, esperar para siempre.
 */

describe("pasos para manejar la app", () => {
  it("acepta los pasos por texto y completa los valores por defecto", () => {
    const r = validarPasos([
      { accion: "tocar_texto", texto: "  Fotos " },
      { accion: "tocar_texto", texto: "Guardar", n: 2, exacto: true },
      { accion: "esperar_texto", texto: "Subida" },
      { accion: "escribir", texto: "Casa 1" },
      { accion: "tecla", tecla: "tab" },
      { accion: "deslizar", direccion: "abajo" },
      { accion: "esperar", segundos: 2 },
    ]);
    expect(r).toEqual({
      ok: true,
      pasos: [
        { accion: "tocar_texto", texto: "Fotos", n: 1, exacto: false },
        { accion: "tocar_texto", texto: "Guardar", n: 2, exacto: true },
        { accion: "esperar_texto", texto: "Subida", segundos: 10, exacto: false },
        { accion: "escribir", texto: "Casa 1" },
        { accion: "tecla", tecla: "tab" },
        { accion: "deslizar", direccion: "abajo" },
        { accion: "esperar", segundos: 2 },
      ],
    });
  });

  it("no hay coordenadas: sólo se toca lo que se nombra", () => {
    const r = validarPasos([{ accion: "tocar", x: 0.5, y: 0.5 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/paso 1/i);
  });

  it("rechaza pasos vacíos, desconocidos o de más", () => {
    expect(validarPasos([]).ok).toBe(false);
    expect(validarPasos("tocar Fotos").ok).toBe(false);
    expect(validarPasos([{ accion: "tocar_texto", texto: "   " }]).ok).toBe(false);
    expect(validarPasos([{ accion: "tecla", tecla: "power" }]).ok).toBe(false);
    expect(validarPasos([{ accion: "deslizar", direccion: "diagonal" }]).ok).toBe(false);
    expect(validarPasos(Array.from({ length: MAX_PASOS + 1 }, () => ({ accion: "esperar", segundos: 1 }))).ok).toBe(false);
  });

  it("acota esperas, repeticiones y texto: un agente no bloquea el teléfono ni escribe una novela", () => {
    const r = validarPasos([
      { accion: "esperar_texto", texto: "Listo", segundos: 600 },
      { accion: "esperar", segundos: 90 },
      { accion: "tocar_texto", texto: "Foto", n: 99 },
    ]);
    expect(r.ok && r.pasos).toEqual([
      { accion: "esperar_texto", texto: "Listo", segundos: 30, exacto: false },
      { accion: "esperar", segundos: 10 },
      { accion: "tocar_texto", texto: "Foto", n: 20, exacto: false },
    ]);
    expect(validarPasos([{ accion: "escribir", texto: "x".repeat(501) }]).ok).toBe(false);
  });

  it("el texto a escribir va literal (se escapa al ejecutarlo), pero sin saltos de línea", () => {
    expect(validarPasos([{ accion: "escribir", texto: "a; rm -rf / $(id)" }]).ok).toBe(true);
    expect(validarPasos([{ accion: "escribir", texto: "linea1\nlinea2" }]).ok).toBe(false);
  });
});
