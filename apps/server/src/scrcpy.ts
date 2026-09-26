import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { randomInt } from "node:crypto";
import { dirname, join } from "node:path";

/**
 * La pantalla del teléfono como la ve scrcpy: fluida, con toques en vivo.
 *
 * El primer espejo usaba `screenrecord` + ffmpeg → MJPEG y se veía a los
 * saltos. Medido sobre un Galaxy S24 por Wi-Fi, con tres causas que se sumaban
 * y que ningún ajuste de parámetros arregla: el H.264 crudo de `screenrecord`
 * no dice dónde termina un cuadro (adb lo entrega en pedazos de 8 KB y adivinar
 * el corte por silencio **partía cuadros**: ffmpeg reportaba "corrupt decoded
 * frame"), recodificar a JPEG obligaba a limitar a 20 cuadros por segundo lo
 * que el teléfono daba a 50, y los toques iban por `adb shell input`, que
 * arranca una JVM por evento (~100 ms) y no sabe arrastrar: la pantalla recién
 * se movía al soltar.
 *
 * `scrcpy-server` (Apache-2.0, el de `brew install scrcpy`) resuelve las tres
 * en el teléfono: manda **cada paquete de MediaCodec con su tamaño y sus
 * banderas** (config, clave) —el cuadro llega entero o no llega—, y recibe
 * eventos de toque (bajar, mover, subir), rueda y texto UTF-8 por un socket de
 * control. El navegador decodifica el H.264 tal cual con WebCodecs. Medido: de
 * ~300 ms a ~110 ms entre el toque y el primer cuadro, y el arrastre se ve
 * mientras se hace.
 *
 * El protocolo es interno de scrcpy y **cambia entre versiones**: el servidor
 * se niega a arrancar si la versión que le pasa el cliente no es la suya. Por
 * eso la versión se lee del `scrcpy` instalado junto al servidor, nunca se
 * escribe a mano. Documentado en `doc/develop.md` de scrcpy (4.x).
 */

export interface InstalacionScrcpy {
  servidor: string;
  version: string;
}

/** El servidor y su versión: el de brew, o el que diga `SCRCPY_SERVER_PATH` (+ `SCRCPY_VERSION`). */
export async function detectarScrcpy(env: NodeJS.ProcessEnv = process.env): Promise<InstalacionScrcpy | null> {
  const candidatos = [
    env.SCRCPY_SERVER_PATH,
    "/opt/homebrew/share/scrcpy/scrcpy-server",
    "/usr/local/share/scrcpy/scrcpy-server",
    "/usr/share/scrcpy/scrcpy-server",
  ].filter((x): x is string => Boolean(x));
  const servidor = candidatos.find((c) => existsSync(c));
  if (!servidor) return null;
  if (env.SCRCPY_VERSION) return { servidor, version: env.SCRCPY_VERSION };
  // El binario vive en <prefijo>/bin y el servidor en <prefijo>/share/scrcpy.
  const binario = join(dirname(dirname(dirname(servidor))), "bin", "scrcpy");
  const version = await new Promise<string | null>((resolver) =>
    execFile(existsSync(binario) ? binario : "scrcpy", ["--version"], { timeout: 5_000 }, (_e, stdout) =>
      resolver(/scrcpy\s+(\d+\.\d+(?:\.\d+)?)/.exec(String(stdout))?.[1] ?? null),
    ),
  );
  return version ? { servidor, version } : null;
}

// --- Mensajes de control (formato de `app/tests/test_control_msg_serialize.c`) -----

const TIPO = { tecla: 0, texto: 1, toque: 2, rueda: 3, reiniciarVideo: 17 } as const;
export const ACCION_TOQUE = { abajo: 0, arriba: 1, mover: 2 } as const;
/** `SC_POINTER_ID_GENERIC_FINGER`: el servidor lo inyecta como un dedo, no como un mouse. */
const DEDO = 0xfffffffffffffffen;
export const MAX_TEXTO = 300;

export function mensajeToque(accion: number, x: number, y: number, ancho: number, alto: number): Buffer {
  const b = Buffer.alloc(32);
  b[0] = TIPO.toque;
  b[1] = accion;
  b.writeBigUInt64BE(DEDO, 2);
  b.writeUInt32BE(Math.max(0, Math.round(x)), 10);
  b.writeUInt32BE(Math.max(0, Math.round(y)), 14);
  b.writeUInt16BE(ancho, 18);
  b.writeUInt16BE(alto, 20);
  // Presión en punto fijo u16: 1.0 → 0xffff. Al soltar, 0. Sin botones: es un dedo.
  b.writeUInt16BE(accion === ACCION_TOQUE.arriba ? 0 : 0xffff, 22);
  return b;
}

/** Rueda: los desplazamientos van en [-16, 16] codificados como i16. */
export function mensajeRueda(x: number, y: number, ancho: number, alto: number, h: number, v: number): Buffer {
  const b = Buffer.alloc(21);
  b[0] = TIPO.rueda;
  b.writeUInt32BE(Math.max(0, Math.round(x)), 1);
  b.writeUInt32BE(Math.max(0, Math.round(y)), 5);
  b.writeUInt16BE(ancho, 9);
  b.writeUInt16BE(alto, 11);
  const fijo = (f: number) => Math.max(-0x8000, Math.min(0x7fff, Math.round((Math.max(-16, Math.min(16, f)) / 16) * 0x8000)));
  b.writeInt16BE(fijo(h), 13);
  b.writeInt16BE(fijo(v), 15);
  b.writeUInt32BE(0, 17);
  return b;
}

export function mensajeTecla(accion: 0 | 1, codigo: number): Buffer {
  const b = Buffer.alloc(14);
  b[0] = TIPO.tecla;
  b[1] = accion;
  b.writeUInt32BE(codigo, 2);
  b.writeUInt32BE(0, 6);
  b.writeUInt32BE(0, 10);
  return b;
}

/** Texto UTF-8 tal cual: acá sí llegan las tildes y las eñes (`input text` sólo escribe ASCII). */
export function mensajeTexto(texto: string): Buffer {
  let bytes = Buffer.from(texto, "utf8");
  if (bytes.length > MAX_TEXTO) bytes = bytes.subarray(0, MAX_TEXTO);
  const b = Buffer.alloc(5 + bytes.length);
  b[0] = TIPO.texto;
  b.writeUInt32BE(bytes.length, 1);
  bytes.copy(b, 5);
  return b;
}

// --- El video -----------------------------------------------------------------------

export type TipoDePaquete = "sesion" | "config" | "clave" | "delta";
export interface Paquete {
  tipo: TipoDePaquete;
  datos: Buffer;
}

/**
 * Lee el stream de video: `u32` codec, y después paquetes de sesión (12 bytes,
 * bit alto encendido: ancho y alto) o de medios (cabecera de 12 bytes con las
 * banderas config/clave y el tamaño, y el paquete entero).
 */
export class LectorDeVideo {
  private buf: Buffer = Buffer.alloc(0);
  private codec: number | null = null;

  constructor(private readonly alPaquete: (p: Paquete) => void) {}

  empujar(d: Buffer): void {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    for (;;) {
      if (this.codec == null) {
        if (this.buf.length < 4) return;
        this.codec = this.buf.readUInt32BE(0);
        if (this.codec !== 0x68323634) throw new Error(`Códec de video inesperado: 0x${this.codec.toString(16)} (se pidió h264).`);
        this.buf = this.buf.subarray(4);
        continue;
      }
      if (this.buf.length < 12) return;
      if (this.buf[0]! & 0x80) {
        this.alPaquete({ tipo: "sesion", datos: Buffer.from(this.buf.subarray(4, 12)) });
        this.buf = this.buf.subarray(12);
        continue;
      }
      const tamano = this.buf.readUInt32BE(8);
      if (this.buf.length < 12 + tamano) return;
      const config = (this.buf[0]! & 0x40) !== 0;
      const clave = (this.buf[0]! & 0x20) !== 0;
      this.alPaquete({ tipo: config ? "config" : clave ? "clave" : "delta", datos: Buffer.from(this.buf.subarray(12, 12 + tamano)) });
      this.buf = this.buf.subarray(12 + tamano);
    }
  }
}

/** Lo que viaja al navegador: `[tipo u8][largo u32][datos]`, con tipo 0 sesión, 1 config, 2 clave, 3 delta. */
export function empaquetar(p: Paquete): Buffer {
  const cabecera = Buffer.alloc(5);
  cabecera[0] = { sesion: 0, config: 1, clave: 2, delta: 3 }[p.tipo];
  cabecera.writeUInt32BE(p.datos.length, 1);
  return Buffer.concat([cabecera, p.datos]);
}

// --- La sesión con un teléfono --------------------------------------------------------

const RUTA_EN_TELEFONO = "/data/local/tmp/scrcpy-server-orq.jar";

export class SesionScrcpy {
  private servidor: ChildProcess | null = null;
  private video: Socket | null = null;
  private control: Socket | null = null;
  private puerto = 0;
  private readonly oyentes = new Set<(p: Paquete) => void>();
  private readonly alCerrar = new Set<() => void>();
  /** Tamaño del video: las coordenadas de los toques van en este sistema. */
  tamano: { ancho: number; alto: number } | null = null;
  cerrada = false;
  /** Por qué se cerró, si no fue a pedido: para el registro del servidor. */
  motivo: string | null = null;
  private capturando = false;
  private registro = "";

  constructor(
    private readonly adb: string,
    private readonly serial: string,
    private readonly instalacion: InstalacionScrcpy,
  ) {}

  async abrir(): Promise<void> {
    const scid = randomInt(1, 0x7fffffff).toString(16).padStart(8, "0");
    await correr(this.adb, ["-s", this.serial, "push", this.instalacion.servidor, RUTA_EN_TELEFONO], 30_000);
    // Túnel "forward": acá se conecta, el teléfono escucha. No abre nada a la red.
    this.puerto = 27_183 + randomInt(0, 2_000);
    await correr(this.adb, ["-s", this.serial, "forward", `tcp:${this.puerto}`, `localabstract:scrcpy_${scid}`], 10_000);
    const opciones = [
      `scid=${scid}`,
      "log_level=warn",
      "tunnel_forward=true",
      "audio=false",
      "control=true",
      "video_codec=h264",
      // Ancho de banda de Wi-Fi y nitidez de sobra para mirar una app en un panel.
      "max_size=1280",
      "max_fps=60",
      "video_bit_rate=8000000",
      "send_device_meta=false",
      // Restaura lo que toque al cerrar (p. ej. mantener la pantalla activa).
      "cleanup=true",
      // Con la pantalla prendida mientras está enchufado, la depuración inalámbrica se cae menos.
      "stay_awake=true",
    ];
    this.servidor = spawn(this.adb, [
      "-s",
      this.serial,
      "shell",
      `CLASSPATH=${RUTA_EN_TELEFONO} app_process / com.genymobile.scrcpy.Server ${this.instalacion.version} ${opciones.join(" ")}`,
    ]);
    const anotar = (d: Buffer) => {
      this.registro = (this.registro + d.toString()).slice(-4_000);
    };
    this.servidor.stdout?.on("data", anotar);
    this.servidor.stderr?.on("data", anotar);
    this.servidor.on("close", () => {
      this.motivo ??= this.registro.trim().split("\n").slice(-3).join(" ") || "El servidor de scrcpy terminó.";
      this.cerrar();
    });

    // Con túnel forward, el primer socket recibe un byte "dummy" cuando el
    // servidor ya escucha; antes de eso adb acepta la conexión y la corta.
    for (let intento = 0; intento < 60 && !this.video; intento++) {
      const s = await abrirSocket(this.puerto).catch(() => null);
      if (s) {
        const primero = await new Promise<Buffer | null>((resolver) => {
          s.once("data", (d: Buffer) => resolver(d));
          s.once("close", () => resolver(null));
          s.once("error", () => resolver(null));
        });
        if (primero && primero.length > 0) {
          // En pausa hasta que esté el lector: un socket que fluye sin
          // oyentes tira lo que llega, y lo primero es el códec.
          s.pause();
          this.video = s;
          if (primero.length > 1) s.unshift(primero.subarray(1));
          break;
        }
        s.destroy();
      }
      if (this.cerrada) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!this.video) {
      this.cerrar();
      throw new Error(`scrcpy no arrancó en el teléfono. ${this.registro.trim().slice(-400)}`);
    }
    this.control = await abrirSocket(this.puerto);
    this.control.on("error", () => this.cerrar());
    // El teléfono manda mensajes por el control (portapapeles): se descartan.
    this.control.on("data", () => {});

    const lector = new LectorDeVideo((p) => {
      if (p.tipo === "sesion") this.tamano = { ancho: p.datos.readUInt32BE(0), alto: p.datos.readUInt32BE(4) };
      else this.capturando = true;
      for (const oyente of this.oyentes) oyente(p);
    });
    this.video.on("data", (d: Buffer) => {
      try {
        lector.empujar(d);
      } catch (error) {
        this.motivo = error instanceof Error ? error.message : String(error);
        this.cerrar();
      }
    });
    this.video.on("close", () => this.cerrar());
    this.video.on("error", () => this.cerrar());
    this.video.resume();
  }

  /** Un espectador nuevo: se pide un cuadro clave para que pueda empezar a decodificar ya. */
  suscribir(oyente: (p: Paquete) => void, alCerrar: () => void): () => void {
    this.oyentes.add(oyente);
    this.alCerrar.add(alCerrar);
    if (this.tamano) {
      const sesion = Buffer.alloc(8);
      sesion.writeUInt32BE(this.tamano.ancho, 0);
      sesion.writeUInt32BE(this.tamano.alto, 4);
      oyente({ tipo: "sesion", datos: sesion });
    }
    // Sólo si la captura ya arrancó: el primero recibe la config y el cuadro
    // clave igual, y pedir un reinicio antes de que exista la captura tira
    // abajo el servidor (NullPointerException en Controller.resetVideo, 4.1).
    if (this.capturando) this.enviar(Buffer.from([TIPO.reiniciarVideo]));
    return () => {
      this.oyentes.delete(oyente);
      this.alCerrar.delete(alCerrar);
    };
  }

  /** Un cuadro clave ya: para el espectador que se atrasó y saltó cuadros. */
  pedirCuadroClave(): void {
    if (this.capturando) this.enviar(Buffer.from([TIPO.reiniciarVideo]));
  }

  get espectadores(): number {
    return this.oyentes.size;
  }

  enviar(mensaje: Buffer): void {
    if (this.control && !this.control.destroyed) this.control.write(mensaje);
  }

  cerrar(): void {
    if (this.cerrada) return;
    this.cerrada = true;
    this.video?.destroy();
    this.control?.destroy();
    this.servidor?.kill("SIGKILL");
    if (this.puerto) execFile(this.adb, ["-s", this.serial, "forward", "--remove", `tcp:${this.puerto}`], () => {});
    for (const f of this.alCerrar) f();
    this.alCerrar.clear();
    this.oyentes.clear();
  }
}

function abrirSocket(puerto: number): Promise<Socket> {
  return new Promise((resolver, rechazar) => {
    const s = connect(puerto, "127.0.0.1");
    s.setNoDelay(true);
    s.once("connect", () => resolver(s));
    s.once("error", rechazar);
  });
}

function correr(ejecutable: string, args: string[], corteMs: number): Promise<string> {
  return new Promise((resolver, rechazar) =>
    execFile(ejecutable, args, { timeout: corteMs }, (error, stdout, stderr) =>
      error ? rechazar(new Error(`${args.slice(2, 4).join(" ")}: ${String(stderr || error.message).trim()}`)) : resolver(String(stdout)),
    ),
  );
}
