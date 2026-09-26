import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

/**
 * Un WebSocket de servidor mínimo (RFC 6455): handshake, marcos
 * enmascarados, fragmentación, ping/pong y cierre. Existe para el espejo del
 * teléfono: los toques en vivo como un pedido HTTP cada uno pasaban por el
 * proxy de Vite con picos de 60 ms (p90; 1,4 ms directo), y un arrastre con
 * esos saltos no se siente natural por más fluido que sea el video. Una sola
 * conexión persistente lleva el video hacia el navegador y los toques hacia el
 * teléfono, en orden y sin un pedido por evento.
 *
 * El `Origin` se verifica acá porque un WebSocket **no** pasa por CORS: sin
 * esto, cualquier página abierta en el navegador podría manejar el teléfono.
 */

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_MENSAJE = 1024 * 1024;

export interface ConexionWs {
  enviarBinario(datos: Buffer): void;
  enviarTexto(texto: string): void;
  alTexto(f: (texto: string) => void): void;
  alCerrar(f: () => void): void;
  cerrar(): void;
  /** Bytes pendientes de salir: para no amontonar video si el navegador no da abasto. */
  readonly pendiente: number;
}

export function aceptarWebSocket(
  req: IncomingMessage,
  socket: Duplex,
  cabeza: Buffer,
  origenes: Set<string> | null,
): ConexionWs | null {
  const clave = req.headers["sec-websocket-key"];
  const origen = req.headers.origin;
  if (typeof clave !== "string" || String(req.headers.upgrade).toLowerCase() !== "websocket") {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    return null;
  }
  if (origen && origenes && !origenes.has(origen)) {
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    return null;
  }
  const aceptar = createHash("sha1").update(clave + GUID).digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${aceptar}\r\n\r\n`);
  (socket as Duplex & { setNoDelay?: (v: boolean) => void }).setNoDelay?.(true);

  const oyentesTexto: Array<(t: string) => void> = [];
  const oyentesCierre: Array<() => void> = [];
  let cerrada = false;
  let buf: Buffer = cabeza.length ? Buffer.from(cabeza) : Buffer.alloc(0);
  let fragmentos: Buffer[] = [];
  let opFragmentado = 0;

  const marco = (op: number, carga: Buffer) => {
    let cab: Buffer;
    if (carga.length < 126) cab = Buffer.from([0x80 | op, carga.length]);
    else if (carga.length < 65_536) {
      cab = Buffer.alloc(4);
      cab[0] = 0x80 | op;
      cab[1] = 126;
      cab.writeUInt16BE(carga.length, 2);
    } else {
      cab = Buffer.alloc(10);
      cab[0] = 0x80 | op;
      cab[1] = 127;
      cab.writeBigUInt64BE(BigInt(carga.length), 2);
    }
    return Buffer.concat([cab, carga]);
  };
  const escribir = (op: number, carga: Buffer) => {
    if (!cerrada && socket.writable) socket.write(marco(op, carga));
  };
  const terminar = () => {
    if (cerrada) return;
    cerrada = true;
    socket.destroy();
    for (const f of oyentesCierre) f();
  };

  const procesar = () => {
    for (;;) {
      if (buf.length < 2) return;
      const fin = (buf[0]! & 0x80) !== 0;
      const op = buf[0]! & 0x0f;
      const enmascarado = (buf[1]! & 0x80) !== 0;
      let largo = buf[1]! & 0x7f;
      let i = 2;
      if (largo === 126) {
        if (buf.length < 4) return;
        largo = buf.readUInt16BE(2);
        i = 4;
      } else if (largo === 127) {
        if (buf.length < 10) return;
        largo = Number(buf.readBigUInt64BE(2));
        i = 10;
      }
      if (largo > MAX_MENSAJE) return terminar();
      const mascara = enmascarado ? buf.subarray(i, i + 4) : null;
      if (enmascarado) i += 4;
      if (buf.length < i + largo) return;
      const carga = Buffer.from(buf.subarray(i, i + largo));
      if (mascara) for (let j = 0; j < carga.length; j++) carga[j]! ^= mascara[j % 4]!;
      buf = buf.subarray(i + largo);

      if (op === 8) {
        escribir(8, Buffer.alloc(0));
        return terminar();
      }
      if (op === 9) {
        escribir(10, carga);
        continue;
      }
      if (op === 10) continue;
      if (op === 1 || op === 2) {
        fragmentos = [carga];
        opFragmentado = op;
      } else if (op === 0) fragmentos.push(carga);
      else continue;
      if (fin) {
        const mensaje = Buffer.concat(fragmentos);
        fragmentos = [];
        if (opFragmentado === 1) for (const f of oyentesTexto) f(mensaje.toString("utf8"));
      }
    }
  };

  socket.on("data", (d: Buffer) => {
    buf = buf.length ? Buffer.concat([buf, d]) : d;
    procesar();
  });
  socket.on("close", terminar);
  socket.on("error", terminar);
  if (buf.length) procesar();

  return {
    enviarBinario: (datos) => escribir(2, datos),
    enviarTexto: (texto) => escribir(1, Buffer.from(texto, "utf8")),
    alTexto: (f) => oyentesTexto.push(f),
    alCerrar: (f) => oyentesCierre.push(f),
    cerrar: () => {
      escribir(8, Buffer.alloc(0));
      terminar();
    },
    get pendiente() {
      return (socket as Duplex & { writableLength: number }).writableLength ?? 0;
    },
  };
}
