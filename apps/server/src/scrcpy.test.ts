import { describe, expect, it } from "vitest";
import { LectorDeVideo, empaquetar, mensajeRueda, mensajeTecla, mensajeTexto, mensajeToque, type Paquete } from "./scrcpy.js";

/**
 * El protocolo de scrcpy 4.x, fijado con los mismos bytes que esperan sus
 * propios tests (`app/tests/test_control_msg_serialize.c`). Si una versión
 * nueva cambia el formato, esto falla acá y no en el teléfono de alguien.
 */

describe("protocolo de scrcpy", () => {
  it("toque: como test_serialize_inject_touch_event, con un dedo genérico y sin botones", () => {
    const b = mensajeToque(0, 100, 200, 1080, 1920);
    expect(b.length).toBe(32);
    expect([...b]).toEqual([
      2, // INJECT_TOUCH_EVENT
      0, // ACTION_DOWN
      0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xfe, // SC_POINTER_ID_GENERIC_FINGER (-2)
      0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00, 0xc8, // 100 200
      0x04, 0x38, 0x07, 0x80, // 1080 1920
      0xff, 0xff, // presión 1.0
      0, 0, 0, 0, // action button
      0, 0, 0, 0, // buttons
    ]);
    // Al soltar, presión 0.
    expect([...mensajeToque(1, 100, 200, 1080, 1920).subarray(22, 24)]).toEqual([0, 0]);
  });

  it("rueda: como test_serialize_inject_scroll_event", () => {
    const b = mensajeRueda(260, 1026, 1080, 1920, 16, -16);
    expect([...b.subarray(0, 17)]).toEqual([3, 0x00, 0x00, 0x01, 0x04, 0x00, 0x00, 0x04, 0x02, 0x04, 0x38, 0x07, 0x80, 0x7f, 0xff, 0x80, 0x00]);
    expect(b.length).toBe(21);
  });

  it("tecla y texto UTF-8", () => {
    expect([...mensajeTecla(1, 66)]).toEqual([0, 1, 0, 0, 0, 0x42, 0, 0, 0, 0, 0, 0, 0, 0]);
    const t = mensajeTexto("ñandú");
    expect(t[0]).toBe(1);
    expect(t.readUInt32BE(1)).toBe(Buffer.byteLength("ñandú"));
    expect(t.subarray(5).toString("utf8")).toBe("ñandú");
  });

  it("lee el video: códec, sesión y paquetes enteros aunque lleguen en pedazos", () => {
    const paquetes: Paquete[] = [];
    const lector = new LectorDeVideo((p) => paquetes.push(p));
    const codec = Buffer.from([0x68, 0x32, 0x36, 0x34]);
    const sesion = Buffer.alloc(12);
    sesion[0] = 0x80;
    sesion.writeUInt32BE(590, 4);
    sesion.writeUInt32BE(1280, 8);
    const media = (banderas: number, datos: number[]) => {
      const c = Buffer.alloc(12);
      c[0] = banderas;
      c.writeUInt32BE(datos.length, 8);
      return Buffer.concat([c, Buffer.from(datos)]);
    };
    const todo = Buffer.concat([codec, sesion, media(0x40, [0, 0, 0, 1, 0x67, 0x64, 0, 0x2a]), media(0x20, [1, 2, 3]), media(0x00, [4, 5])]);
    // Pedazos de 5 bytes: como llega por adb, cortado en cualquier lado.
    for (let i = 0; i < todo.length; i += 5) lector.empujar(todo.subarray(i, i + 5));
    expect(paquetes.map((p) => p.tipo)).toEqual(["sesion", "config", "clave", "delta"]);
    expect(paquetes[0]!.datos.readUInt32BE(0)).toBe(590);
    expect([...paquetes[2]!.datos]).toEqual([1, 2, 3]);
    expect([...empaquetar(paquetes[3]!)]).toEqual([3, 0, 0, 0, 2, 4, 5]);
  });

  it("rechaza un códec que no es el pedido", () => {
    const lector = new LectorDeVideo(() => {});
    expect(() => lector.empujar(Buffer.from([0x68, 0x32, 0x36, 0x35]))).toThrow(/h264/);
  });
});
