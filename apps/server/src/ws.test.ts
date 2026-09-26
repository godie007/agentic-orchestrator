import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { connect, type AddressInfo } from "node:net";
import { aceptarWebSocket } from "./ws.js";

/**
 * El WebSocket del espejo contra el `WebSocket` de verdad (el de Node, que es
 * el mismo cliente del navegador): texto hacia el servidor, binario de vuelta,
 * y un origen que no es el de la app no pasa — un WebSocket no tiene CORS.
 */

let servidor: Server | null = null;
afterEach(() => {
  servidor?.close();
  servidor = null;
});

async function levantar(origenes: Set<string> | null): Promise<{ puerto: number; recibidos: string[] }> {
  const recibidos: string[] = [];
  servidor = createServer();
  servidor.on("upgrade", (req, socket, cabeza) => {
    const ws = aceptarWebSocket(req, socket, cabeza, origenes);
    ws?.alTexto((t) => {
      recibidos.push(t);
      // Un paquete grande: fuerza el largo de 16 bits.
      ws.enviarBinario(Buffer.alloc(70_000, 7));
    });
  });
  await new Promise<void>((r) => servidor!.listen(0, "127.0.0.1", r));
  return { puerto: (servidor!.address() as AddressInfo).port, recibidos };
}

describe("WebSocket del espejo", () => {
  it("recibe texto enmascarado y manda binario", async () => {
    const { puerto, recibidos } = await levantar(null);
    const ws = new WebSocket(`ws://127.0.0.1:${puerto}/x`);
    ws.binaryType = "arraybuffer";
    const binario = await new Promise<ArrayBuffer>((resolver, rechazar) => {
      ws.onopen = () => ws.send(JSON.stringify({ t: "toque", a: "abajo", x: 0.5, y: 0.5 }));
      ws.onmessage = (e) => resolver(e.data as ArrayBuffer);
      ws.onerror = () => rechazar(new Error("falló"));
    });
    expect(recibidos).toEqual(['{"t":"toque","a":"abajo","x":0.5,"y":0.5}']);
    expect(binario.byteLength).toBe(70_000);
    expect(new Uint8Array(binario)[69_999]).toBe(7);
    ws.close();
  });

  it("rechaza un origen que no es el de la app", async () => {
    const { puerto } = await levantar(new Set(["http://localhost:5173"]));
    const respuesta = await new Promise<string>((resolver) => {
      const s = connect(puerto, "127.0.0.1", () => {
        s.write(
          "GET /x HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nOrigin: http://pagina-cualquiera.com\r\n\r\n",
        );
      });
      s.on("data", (d) => resolver(d.toString()));
    });
    expect(respuesta).toMatch(/^HTTP\/1.1 403/);
  });
});
