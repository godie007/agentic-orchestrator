import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { z } from "zod";
import type { Runtime } from "./runtime.js";
import { empaquetar } from "./scrcpy.js";
import { aceptarWebSocket } from "./ws.js";

/**
 * `/api/dispositivos/:serial/espejo`: el espejo del teléfono por una sola
 * conexión. Hacia el navegador van los paquetes H.264 de scrcpy (un mensaje
 * binario cada uno, `[tipo u8][largo u32][datos]`); desde el navegador vienen
 * los toques, la rueda, las teclas y el texto, en orden.
 *
 * Si el navegador no da abasto (una pestaña en segundo plano, una máquina
 * cargada), el video no se amontona: pasado un tope de bytes pendientes se
 * dejan de mandar cuadros intermedios y se pide un cuadro clave. Lo que se ve
 * salta al presente en vez de ir cada vez más atrasado.
 */

const RUTA = /^\/api\/dispositivos\/([^/?]+)\/espejo(?:\?.*)?$/;
const TOPE_PENDIENTE = 1_500_000;

const mensaje = z.discriminatedUnion("t", [
  z.object({ t: z.literal("toque"), a: z.enum(["abajo", "mover", "arriba"]), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
  z.object({ t: z.literal("rueda"), x: z.number().min(0).max(1), y: z.number().min(0).max(1), h: z.number().min(-16).max(16), v: z.number().min(-16).max(16) }),
  z.object({ t: z.literal("tecla"), k: z.enum(["atras", "inicio", "recientes", "enter", "borrar", "menu"]) }),
  z.object({ t: z.literal("texto"), s: z.string().min(1).max(300) }),
]);

export function manejarEspejoWs(runtime: Runtime, origenes: Set<string> | null) {
  return (req: IncomingMessage, socket: Duplex, cabeza: Buffer): boolean => {
    const m = RUTA.exec(req.url ?? "");
    if (!m) return false;
    const serial = decodeURIComponent(m[1]!);
    const ws = aceptarWebSocket(req, socket, cabeza, origenes);
    if (!ws) return true;

    let soltar: (() => void) | null = null;
    let cerrada = false;
    let saltando = false;
    ws.alCerrar(() => {
      cerrada = true;
      soltar?.();
    });
    ws.alTexto((texto) => {
      let dato: unknown;
      try {
        dato = JSON.parse(texto);
      } catch {
        return;
      }
      const r = mensaje.safeParse(dato);
      if (!r.success) return;
      const d = r.data;
      try {
        if (d.t === "toque") runtime.dispositivos.toque(serial, d.a, d.x, d.y);
        else if (d.t === "rueda") runtime.dispositivos.rueda(serial, d.x, d.y, d.h, d.v);
        else if (d.t === "tecla") void runtime.dispositivos.tecla(serial, d.k).catch(() => {});
        else void runtime.dispositivos.escribir(serial, d.s).catch(() => {});
      } catch {
        // la sesión se está cerrando: el navegador reconecta
      }
    });

    void (async () => {
      try {
        if ((await runtime.dispositivos.motorDeEspejo()).motor !== "scrcpy") throw new Error("scrcpy no está instalado (brew install scrcpy).");
        const lista = await runtime.dispositivos.listar();
        if (!lista.some((d) => d.serial === serial && d.estado === "device")) throw new Error("Ese teléfono no está conectado.");
        soltar = await runtime.dispositivos.mirar(
          serial,
          (p) => {
            if (p.tipo === "clave") saltando = false;
            else if (p.tipo === "delta") {
              if (saltando) return;
              if (ws.pendiente > TOPE_PENDIENTE) {
                saltando = true;
                runtime.dispositivos.pedirCuadroClave(serial);
                return;
              }
            }
            ws.enviarBinario(empaquetar(p));
          },
          () => ws.cerrar(),
        );
        if (cerrada) soltar();
      } catch (error) {
        ws.enviarTexto(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        ws.cerrar();
      }
    })();
    return true;
  };
}
