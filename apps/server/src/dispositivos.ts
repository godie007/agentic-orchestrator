import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { randomBytes, randomInt } from "node:crypto";
import qrcode from "qrcode-generator";
import { entornoDeComando } from "@orq/tools";
import {
  ACCION_TOQUE,
  MAX_TEXTO,
  SesionScrcpy,
  detectarScrcpy as detectarScrcpyInstalado,
  mensajeTecla,
  mensajeTexto,
  mensajeToque,
  mensajeRueda,
  type InstalacionScrcpy,
  type Paquete,
} from "./scrcpy.js";

/**
 * El celular de la persona como vista previa de una app móvil.
 *
 * Una app de React Native con módulos nativos (un visor de PDF, SQLite, la
 * cámara) no se puede ver en el navegador: `expo start --web` ni siquiera arma
 * el bundle. Lo que sí se puede es lo que hace Android Studio: **vincular el
 * teléfono por QR** con la depuración inalámbrica, instalarle una build de
 * desarrollo una vez, y de ahí en más la app baja el JavaScript del Metro de la
 * sesión —el mismo que ya levanta el orquestador—, así que cada edición de un
 * agente se ve en el teléfono sin compilar nada.
 *
 * Tres decisiones:
 *
 * - **El QR es el de Android, no el de Expo Go.** Expo Go no trae los módulos
 *   nativos de la app y muere al abrir la primera pantalla que los usa. El QR
 *   de depuración inalámbrica (`WIFI:T:ADB;S:<nombre>;P:<clave>;;`) vincula el
 *   teléfono con `adb` y sirve para cualquier app.
 * - **`adb reverse`, no la IP de la red.** El bundle ya viene con la API en
 *   `127.0.0.1:<puerto>` (lo reescribe la vista previa), y en el teléfono
 *   `127.0.0.1` es el teléfono: se le tiende un túnel por cada puerto de los
 *   servicios del repo y el 8081 al Metro. No se abre nada a la red local.
 * - **La build se instala a pedido de la persona**, con su JDK y su SDK, y
 *   **sin las credenciales del orquestador** en el entorno: Gradle corre
 *   scripts del repo, y el repo lo pudo haber editado un agente.
 */

// Sólo para el espejo de respaldo (sin scrcpy).
const INTERVALO_CUADRO_MS = 33;
/**
 * Sin datos del teléfono por este tiempo, el cuadro que llegó se da por
 * completo. Con 12 ms se partían cuadros: por Wi-Fi un mismo cuadro llega en
 * pedazos de 8 KB separados por más que eso, y ffmpeg reportaba "corrupt
 * decoded frame". 60 ms sólo demora el último cuadro de una pantalla que se
 * quedó quieta; durante una animación el corte lo marca el cuadro siguiente.
 */
const SILENCIO_CUADRO_MS = 60;
const AUD = Buffer.from([0, 0, 0, 1, 0x09, 0xf0]);
const TIEMPO_VINCULO_MS = 3 * 60_000;
const CORTE_ADB_MS = 20_000;
const CORTE_INSTALAR_MS = 30 * 60_000;
const MAX_LINEAS = 2_000;

export interface Dispositivo {
  serial: string;
  /** `device` = listo; `unauthorized` = falta aceptar el aviso en el teléfono. */
  estado: string;
  modelo: string | null;
  inalambrico: boolean;
  /**
   * El `transport_id` de adb: cambia en cada reconexión aunque el serial sea el
   * mismo, y con él se pierden los túneles. Es la identidad de la conexión.
   */
  transporte?: string;
}

export type EstadoDeVinculo = "esperando" | "vinculando" | "listo" | "fallo" | "vencido";

export interface Vinculo {
  id: string;
  estado: EstadoDeVinculo;
  detalle: string | null;
  serial: string | null;
  /** El QR como SVG, listo para dibujar. */
  qr: string;
  vence: number;
}

export interface Instalacion {
  estado: "instalando" | "listo" | "fallo";
  lineas: string[];
  desde: number;
}

export type Correr = (argv: string[], opciones?: { corteMs?: number; env?: NodeJS.ProcessEnv }) => Promise<{ codigo: number; salida: string }>;

export const correrReal: Correr = (argv, opciones = {}) =>
  new Promise((resolver) => {
    const [ejecutable, ...resto] = argv;
    execFile(
      ejecutable!,
      resto,
      { timeout: opciones.corteMs ?? CORTE_ADB_MS, maxBuffer: 8 * 1024 * 1024, env: opciones.env ?? process.env },
      (error, stdout, stderr) => {
        const codigo = error ? (typeof (error as { code?: unknown }).code === "number" ? ((error as { code: number }).code) : 1) : 0;
        resolver({ codigo, salida: `${stdout}${stderr}` });
      },
    );
  });

/** Dónde está `adb`: el SDK de Android Studio en su lugar de siempre, o el PATH. */
export function detectarAdb(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidatos = [
    env.ANDROID_HOME && join(env.ANDROID_HOME, "platform-tools", "adb"),
    env.ANDROID_SDK_ROOT && join(env.ANDROID_SDK_ROOT, "platform-tools", "adb"),
    join(homedir(), "Library", "Android", "sdk", "platform-tools", "adb"),
    join(homedir(), "Android", "Sdk", "platform-tools", "adb"),
    ...(env.PATH ?? "").split(delimiter).filter(Boolean).map((dir) => join(dir, "adb")),
  ].filter((x): x is string => Boolean(x));
  return candidatos.find((c) => existsSync(c)) ?? null;
}

/** `adb devices -l`. */
export function parsearDispositivos(salida: string): Dispositivo[] {
  const lista: Dispositivo[] = [];
  for (const linea of salida.split("\n")) {
    const m = /^(\S+)\s+(device|unauthorized|offline|authorizing|no permissions)\b(.*)$/.exec(linea.trim());
    if (!m) continue;
    const modelo = /\bmodel:(\S+)/.exec(m[3] ?? "")?.[1]?.replace(/_/g, " ") ?? null;
    const transporte = /\btransport_id:(\d+)/.exec(m[3] ?? "")?.[1];
    lista.push({
      serial: m[1]!,
      estado: m[2]!,
      modelo,
      // Un serial con IP:puerto, o el nombre que usa adb para los que vio por mDNS.
      inalambrico: /:\d+$/.test(m[1]!) || m[1]!.includes("._adb-tls-connect."),
      ...(transporte ? { transporte } : {}),
    });
  }
  return lista;
}

/** `adb mdns services`: `nombre \t _tipo._tcp \t ip:puerto`. */
export function parsearMdns(salida: string): Array<{ nombre: string; tipo: string; direccion: string }> {
  const lista: Array<{ nombre: string; tipo: string; direccion: string }> = [];
  for (const linea of salida.split("\n")) {
    const partes = linea.trim().split(/\s+/);
    if (partes.length < 3) continue;
    const [nombre, tipo, direccion] = partes as [string, string, string];
    if (!tipo.startsWith("_adb") || !/:\d+$/.test(direccion)) continue;
    lista.push({ nombre, tipo: tipo.replace(/\.$/, ""), direccion });
  }
  return lista;
}

/** El texto del QR de "Vincular dispositivo con código QR" de Android. */
export function textoDeVinculo(nombre: string, clave: string): string {
  return `WIFI:T:ADB;S:${nombre};P:${clave};;`;
}

export function qrSvg(texto: string): string {
  const qr = qrcode(0, "M");
  qr.addData(texto);
  qr.make();
  return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
}

/** El paquete de Android de una app de Expo, de su `app.json`. */
export async function paqueteDeLaApp(carpeta: string): Promise<string | null> {
  try {
    const app = JSON.parse(await readFile(join(carpeta, "app.json"), "utf8")) as { expo?: { android?: { package?: string } } };
    return app.expo?.android?.package ?? null;
  } catch {
    return null;
  }
}

/** Un JDK para Gradle: el de la persona, el 17 del sistema o el que trae Android Studio. */
export async function detectarJava(correr: Correr): Promise<string | null> {
  if (process.env.JAVA_HOME && existsSync(process.env.JAVA_HOME)) return process.env.JAVA_HOME;
  const { codigo, salida } = await correr(["/usr/libexec/java_home", "-v", "17"]);
  if (codigo === 0 && salida.trim() && existsSync(salida.trim())) return salida.trim();
  const studio = "/Applications/Android Studio.app/Contents/jbr/Contents/Home";
  return existsSync(studio) ? studio : null;
}

export class Dispositivos {
  private readonly vinculos = new Map<string, Vinculo & { nombre: string; clave: string }>();
  private readonly instalaciones = new Map<string, Instalacion>();
  /** Las capturas de pantalla vivas: un reinicio del servidor no puede dejarlas grabando. */
  private readonly capturas = new Set<ChildProcess>();

  // --- Espejo con scrcpy -----------------------------------------------------------

  private instalacionScrcpy: Promise<InstalacionScrcpy | null> | null = null;
  private readonly espejos = new Map<string, SesionScrcpy>();
  private readonly abriendo = new Map<string, Promise<SesionScrcpy>>();
  private readonly cierres = new Map<string, NodeJS.Timeout>();

  /** Qué motor de espejo hay: scrcpy (fluido, toques en vivo) o el de `screenrecord` de respaldo. */
  async motorDeEspejo(): Promise<{ motor: "scrcpy" | "screenrecord"; version: string | null }> {
    this.instalacionScrcpy ??= this.detectarScrcpy();
    const inst = await this.instalacionScrcpy;
    return inst ? { motor: "scrcpy", version: inst.version } : { motor: "screenrecord", version: null };
  }

  private espejoVivo(serial: string): SesionScrcpy | null {
    const e = this.espejos.get(serial);
    return e && !e.cerrada ? e : null;
  }

  /** La sesión de scrcpy del teléfono: una por teléfono, compartida entre los que miran. */
  private async espejo(serial: string): Promise<SesionScrcpy> {
    const viva = this.espejoVivo(serial);
    if (viva) return viva;
    const enCurso = this.abriendo.get(serial);
    if (enCurso) return enCurso;
    const abrir = (async () => {
      this.instalacionScrcpy ??= this.detectarScrcpy();
      const inst = await this.instalacionScrcpy;
      if (!inst || !this.adb) throw new Error("scrcpy no está instalado (brew install scrcpy).");
      const sesion = new SesionScrcpy(this.adb, serial, inst);
      await sesion.abrir();
      this.espejos.set(serial, sesion);
      return sesion;
    })();
    this.abriendo.set(serial, abrir);
    try {
      return await abrir;
    } finally {
      this.abriendo.delete(serial);
    }
  }

  /**
   * Un espectador del video. Cuando se va el último, la sesión se cierra a los
   * 5 s: cambiar de pestaña y volver no tiene que rearrancar el servidor en el
   * teléfono.
   */
  async mirar(serial: string, alPaquete: (p: Paquete) => void, alTerminar: () => void): Promise<() => void> {
    const pendiente = this.cierres.get(serial);
    if (pendiente) clearTimeout(pendiente);
    this.cierres.delete(serial);
    const sesion = await this.espejo(serial);
    const soltar = sesion.suscribir(alPaquete, alTerminar);
    return () => {
      soltar();
      if (sesion.espectadores > 0) return;
      this.cierres.set(
        serial,
        setTimeout(() => {
          this.cierres.delete(serial);
          if (sesion.espectadores === 0) {
            sesion.cerrar();
            if (this.espejos.get(serial) === sesion) this.espejos.delete(serial);
          }
        }, 5_000),
      );
    };
  }

  pedirCuadroClave(serial: string): void {
    this.espejoVivo(serial)?.pedirCuadroClave();
  }

  /** Un toque en vivo (bajar, mover, subir) en coordenadas relativas de la pantalla. */
  toque(serial: string, accion: keyof typeof ACCION_TOQUE, x: number, y: number): void {
    const e = this.espejoVivo(serial);
    if (!e?.tamano) throw new Error("No hay un espejo abierto para ese teléfono.");
    const { ancho, alto } = e.tamano;
    e.enviar(mensajeToque(ACCION_TOQUE[accion], x * ancho, y * alto, ancho, alto));
  }

  rueda(serial: string, x: number, y: number, h: number, v: number): void {
    const e = this.espejoVivo(serial);
    if (!e?.tamano) throw new Error("No hay un espejo abierto para ese teléfono.");
    const { ancho, alto } = e.tamano;
    e.enviar(mensajeRueda(x * ancho, y * alto, ancho, alto, h, v));
  }

  detenerCapturas(): void {
    for (const e of this.espejos.values()) e.cerrar();
    this.espejos.clear();
    if (this.vigilancia) clearInterval(this.vigilancia);
    this.vigilancia = null;
    for (const hijo of this.capturas) hijo.kill("SIGKILL");
    this.capturas.clear();
    for (const sh of this.shells.values()) sh.cerrar();
    this.shells.clear();
  }

  constructor(
    private readonly adb: string | null = detectarAdb(),
    private readonly correr: Correr = correrReal,
    private readonly abrirShell: (adb: string, serial: string) => Shell = (adb, serial) => new ShellDeTelefono(adb, serial),
    /** Dónde se recuerda qué app se abrió en cada teléfono. */
    private readonly archivoDestinos: string | null = null,
    private readonly detectarScrcpy: () => Promise<InstalacionScrcpy | null> = () => detectarScrcpyInstalado(),
  ) {}

  get disponible(): boolean {
    return this.adb != null;
  }

  private async deAdb(args: string[], corteMs?: number) {
    if (!this.adb) throw new Error("No se encontró adb: instalá Android Studio (o las platform-tools) para usar un celular.");
    return this.correr([this.adb, ...args], corteMs ? { corteMs } : {});
  }

  /**
   * Los teléfonos conectados. Antes reconecta los ya vinculados que anuncian
   * la depuración inalámbrica: el puerto cambia cada vez que se prende, y adb
   * no se reconecta solo.
   */
  async listar(): Promise<Dispositivo[]> {
    if (!this.adb) return [];
    let lista = parsearDispositivos((await this.deAdb(["devices", "-l"])).salida);
    const anunciados = parsearMdns((await this.deAdb(["mdns", "services"])).salida).filter((s) => s.tipo === "_adb-tls-connect._tcp");
    const listos = new Set(lista.filter((d) => d.estado === "device").map((d) => d.serial));
    const nuevos = anunciados.filter((s) => !listos.has(s.direccion) && ![...listos].some((c) => c.startsWith(s.nombre)));
    // Una conexión inalámbrica vieja del mismo teléfono (otro puerto, ya
    // offline) se suelta: si no, queda en la lista y confunde a quien elige.
    const viejas = lista.filter(
      (d) => d.inalambrico && d.estado !== "device" && anunciados.some((s) => ipDe(s.direccion) === ipDe(d.serial) && s.direccion !== d.serial),
    );
    if (nuevos.length === 0 && viejas.length === 0) {
      await this.retender(lista);
      return lista;
    }
    await Promise.all(viejas.map((d) => this.deAdb(["disconnect", d.serial], 5_000)));
    // Sólo se conecta lo que ya se vinculó: a uno sin vincular adb le contesta que no.
    await Promise.all(nuevos.map((s) => this.deAdb(["connect", s.direccion], 8_000)));
    lista = parsearDispositivos((await this.deAdb(["devices", "-l"])).salida);
    // Los túneles son de la conexión, no del teléfono: con el puerto nuevo se
    // perdieron, y la app se quedaba sin Metro ni API hasta que alguien
    // apretara "Abrir la app". Se vuelven a tender solos.
    await this.retender(lista);
    return lista;
  }

  /**
   * Cada teléfono conectado que tiene una app abierta desde acá recibe sus
   * túneles, calculados **en el momento**: el puerto del Metro cambia cuando
   * se reinicia el servicio, y un túnel recordado apuntaría a un puerto muerto.
   * Se lleva la cuenta de lo tendido por serial y se olvida cuando la conexión
   * se cae, así no importa si la reconectó este proceso o adb por su cuenta.
   */
  private async retender(lista: Dispositivo[]): Promise<void> {
    const vivos = lista.filter((d) => d.estado === "device");
    const claves = new Set(vivos.map(claveDeConexion));
    for (const clave of [...this.tendidos.keys()]) if (!claves.has(clave)) this.tendidos.delete(clave);
    for (const d of vivos) {
      const destino = this.destinos.get(ipDe(d.serial));
      const tuneles = destino ? this.resolverTuneles(destino) : null;
      if (!tuneles) continue;
      const firma = JSON.stringify(tuneles);
      if (this.tendidos.get(claveDeConexion(d)) === firma) continue;
      try {
        await this.tender(d.serial, tuneles);
        this.tendidos.set(claveDeConexion(d), firma);
      } catch {
        // se reintenta en la próxima vuelta
      }
    }
  }

  /** Qué app se abrió en cada teléfono (por IP): sobrevive a que cambie el puerto y a un reinicio del servidor. */
  private readonly destinos = new Map<string, DestinoDeTelefono>();
  private readonly tendidos = new Map<string, string>();
  private resolverTuneles: (destino: DestinoDeTelefono) => Array<[number, number]> | null = () => null;
  private vigilancia: NodeJS.Timeout | null = null;

  /**
   * El runtime dice cómo calcular los túneles de una app (depende de qué
   * servicios corren y en qué puerto) y desde acá se mantienen: cada 10 s se
   * mira si algún teléfono volvió con otra conexión o si cambió un puerto.
   */
  mantenerTuneles(resolver: (destino: DestinoDeTelefono) => Array<[number, number]> | null): void {
    this.resolverTuneles = resolver;
    this.leerDestinos();
    if (this.vigilancia || !this.adb) return;
    this.vigilancia = setInterval(() => {
      if (this.destinos.size === 0) return;
      void this.listar().catch(() => {});
    }, 10_000);
    this.vigilancia.unref?.();
  }

  private leerDestinos(): void {
    if (!this.archivoDestinos) return;
    try {
      const guardados = JSON.parse(readFileSync(this.archivoDestinos, "utf8")) as Record<string, DestinoDeTelefono>;
      for (const [ip, destino] of Object.entries(guardados)) this.destinos.set(ip, destino);
    } catch {
      // sin archivo todavía
    }
  }

  private guardarDestinos(): void {
    if (!this.archivoDestinos) return;
    try {
      writeFileSync(this.archivoDestinos, JSON.stringify(Object.fromEntries(this.destinos), null, 2));
    } catch {
      // no es grave: se pierde al reiniciar y se vuelve a abrir desde el IDE
    }
  }

  private async tender(serial: string, tuneles: Array<[number, number]>): Promise<void> {
    for (const [telefono, aca] of tuneles) {
      const r = await this.deAdb(["-s", serial, "reverse", `tcp:${telefono}`, `tcp:${aca}`]);
      if (r.codigo !== 0) throw new Error(`No se pudo abrir el túnel ${telefono}→${aca}: ${r.salida.trim()}`);
    }
  }

  /** Arranca un vínculo: el QR y, por detrás, la espera del teléfono. */
  vincular(): Vinculo {
    if (!this.adb) throw new Error("No se encontró adb: instalá Android Studio (o las platform-tools) para usar un celular.");
    const id = `vin_${randomBytes(6).toString("hex")}`;
    const nombre = `orq-${randomBytes(4).toString("hex")}`;
    const clave = String(randomInt(100_000_000, 999_999_999));
    const vinculo: Vinculo & { nombre: string; clave: string } = {
      id,
      nombre,
      clave,
      estado: "esperando",
      detalle: null,
      serial: null,
      qr: qrSvg(textoDeVinculo(nombre, clave)),
      vence: Date.now() + TIEMPO_VINCULO_MS,
    };
    this.vinculos.set(id, vinculo);
    void this.esperarTelefono(vinculo).catch((error: unknown) => {
      vinculo.estado = "fallo";
      vinculo.detalle = error instanceof Error ? error.message : String(error);
    });
    return this.publico(vinculo);
  }

  vinculo(id: string): Vinculo | null {
    const v = this.vinculos.get(id);
    return v ? this.publico(v) : null;
  }

  private publico(v: Vinculo & { nombre: string; clave: string }): Vinculo {
    const { nombre: _n, clave: _c, ...resto } = v;
    return resto;
  }

  /**
   * Al escanear, el teléfono anuncia por mDNS un servicio de vinculación con
   * **el nombre del QR**: así se sabe que es el nuestro y no otro teléfono de
   * la red. Se vincula con la clave, y después se conecta al servicio de
   * depuración que el mismo teléfono anuncia en su IP.
   */
  private async esperarTelefono(v: Vinculo & { nombre: string; clave: string }): Promise<void> {
    while (Date.now() < v.vence) {
      const servicios = parsearMdns((await this.deAdb(["mdns", "services"])).salida);
      const vinculacion = servicios.find((s) => s.tipo === "_adb-tls-pairing._tcp" && s.nombre === v.nombre);
      if (vinculacion) {
        v.estado = "vinculando";
        const par = await this.deAdb(["pair", vinculacion.direccion, v.clave], 30_000);
        if (par.codigo !== 0 || !/success/i.test(par.salida)) {
          v.estado = "fallo";
          v.detalle = `El teléfono no aceptó la vinculación: ${par.salida.trim().slice(0, 300)}`;
          return;
        }
        const ip = vinculacion.direccion.split(":")[0]!;
        // El servicio de conexión aparece un momento después de vincular.
        for (let i = 0; i < 20; i++) {
          const conexion = parsearMdns((await this.deAdb(["mdns", "services"])).salida).find(
            (s) => s.tipo === "_adb-tls-connect._tcp" && s.direccion.startsWith(`${ip}:`),
          );
          if (conexion) {
            await this.deAdb(["connect", conexion.direccion], 10_000);
            const listo = parsearDispositivos((await this.deAdb(["devices", "-l"])).salida).find(
              (d) => d.serial === conexion.direccion || d.serial.startsWith(conexion.nombre),
            );
            if (listo?.estado === "device") {
              v.estado = "listo";
              v.serial = listo.serial;
              v.detalle = listo.modelo ? `Vinculado: ${listo.modelo}.` : "Vinculado.";
              return;
            }
          }
          await espera(1_000);
        }
        v.estado = "listo";
        v.detalle = "Vinculado, pero el teléfono todavía no anunció la depuración: si no aparece en la lista, apagá y prendé la depuración inalámbrica.";
        return;
      }
      await espera(1_000);
    }
    if (v.estado === "esperando") {
      v.estado = "vencido";
      v.detalle = "Pasaron tres minutos sin que el teléfono escaneara el código.";
    }
  }

  async instalada(serial: string, paquete: string): Promise<boolean> {
    const { codigo, salida } = await this.deAdb(["-s", serial, "shell", "pm", "path", "--user", "current", paquete]);
    return codigo === 0 && salida.includes("package:");
  }

  /**
   * Abre la app en el teléfono apuntando a la sesión: el 8081 del teléfono va
   * al Metro de la vista previa y cada puerto de los servicios del repo, al
   * mismo puerto de acá (el bundle ya trae esas URLs).
   */
  async abrir(
    serial: string,
    opciones: { paquete: string; metro: number; puertos: number[]; destino?: DestinoDeTelefono },
  ): Promise<void> {
    const tuneles = tunelesPara(opciones.metro, opciones.puertos);
    await this.tender(serial, tuneles);
    const conexion = parsearDispositivos((await this.deAdb(["devices", "-l"])).salida).find((d) => d.serial === serial);
    if (conexion) this.tendidos.set(claveDeConexion(conexion), JSON.stringify(tuneles));
    if (opciones.destino) {
      this.destinos.set(ipDe(serial), opciones.destino);
      this.guardarDestinos();
    }
    // Cerrarla primero: si ya estaba abierta con otro Metro, se queda con el bundle viejo.
    await this.deAdb(["-s", serial, "shell", "am", "force-stop", "--user", "current", opciones.paquete]);
    const r = await this.deAdb(["-s", serial, "shell", "monkey", "-p", opciones.paquete, "-c", "android.intent.category.LAUNCHER", "1"]);
    if (r.codigo !== 0 || /No activities found|Error/i.test(r.salida)) {
      throw new Error(`No se pudo abrir ${opciones.paquete}: ${r.salida.trim().slice(0, 300)}`);
    }
  }

  // --- Espejo en vivo -----------------------------------------------------------

  /** Tamaño físico de la pantalla, para convertir un toque de la vista a píxeles del teléfono. */
  async tamano(serial: string): Promise<{ ancho: number; alto: number }> {
    const { salida } = await this.deAdb(["-s", serial, "shell", "wm", "size"]);
    // "Override size" gana si la persona cambió la resolución.
    const m = /Override size:\s*(\d+)x(\d+)/.exec(salida) ?? /Physical size:\s*(\d+)x(\d+)/.exec(salida);
    if (!m) throw new Error(`No se pudo leer el tamaño de la pantalla: ${salida.trim().slice(0, 200)}`);
    return { ancho: Number(m[1]), alto: Number(m[2]) };
  }

  /**
   * La pantalla del teléfono como MJPEG: `screenrecord` saca H.264 (sin tope de
   * tiempo) y ffmpeg lo pasa a JPEG cuadro por cuadro, que un `<img>` dibuja
   * sin ningún decodificador en el navegador. `screenrecord` sólo emite cuando
   * la pantalla cambia, así que una pantalla quieta no gasta nada.
   */
  async transmitir(serial: string, alCuadro: (jpeg: Buffer) => void, alTerminar: (motivo: string | null) => void): Promise<() => void> {
    if (!this.adb) throw new Error("No se encontró adb.");
    const { ancho, alto } = await this.tamano(serial);
    // La mitad alcanza para mirar y pesa un cuarto; múltiplos de 16 para el codificador.
    const escala = Math.min(1, 720 / Math.max(ancho, alto) * 1.6);
    const w = Math.max(16, Math.round((ancho * escala) / 16) * 16);
    const h = Math.max(16, Math.round((alto * escala) / 16) * 16);
    const grabar = spawn(this.adb, ["-s", serial, "exec-out", "screenrecord", "--output-format=h264", `--size=${w}x${h}`, "--bit-rate=6000000", "--time-limit=0", "-"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const convertir = spawn(
      "ffmpeg",
      // Sin `-fflags nobuffer`: con él el decodificador no suelta ni un cuadro. Y
      // `yuvj420p` porque el H.264 del teléfono viene en rango limitado y el
      // codificador de JPEG lo rechaza.
      // `-threads 1`: el decodificador con hilos retiene un cuadro por hilo, y
      // con la pantalla quieta esos cuadros no salen nunca.
      ["-hide_banner", "-loglevel", "error", "-flags", "low_delay", "-threads", "1", "-probesize", "32", "-analyzeduration", "0", "-f", "h264", "-i", "pipe:0", "-f", "image2pipe", "-vcodec", "mjpeg", "-pix_fmt", "yuvj420p", "-q:v", "6", "-threads", "1", "pipe:1"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    // El parser de H.264 crudo no sabe que un cuadro terminó hasta que empieza
    // el siguiente: con la pantalla quieta, el último cambio se quedaba
    // adentro de ffmpeg —la vista "se pegaba" un cuadro atrás—. Cuando el
    // teléfono deja de mandar, un delimitador de unidad de acceso (AUD) cierra
    // el cuadro. Medido: de 1 JPEG por 9 envíos a uno por cada cuadro, sin
    // cuadros retenidos.
    let silencio: NodeJS.Timeout | null = null;
    grabar.stdout.on("data", (d: Buffer) => {
      if (!convertir.stdin.writable) return;
      convertir.stdin.write(d);
      if (silencio) clearTimeout(silencio);
      silencio = setTimeout(() => {
        if (convertir.stdin.writable) convertir.stdin.write(AUD);
      }, SILENCIO_CUADRO_MS);
    });
    this.capturas.add(grabar).add(convertir);
    convertir.stdin.on("error", () => {});
    // Una pantalla animada saca 30 cuadros por segundo; al navegador le
    // alcanzan ~16. Se manda el último, y el de cierre de una ráfaga nunca se
    // pierde: si llega antes de tiempo, queda programado.
    let pendiente = Buffer.alloc(0);
    let ultimoEnvio = 0;
    let guardado: Buffer | null = null;
    let programado: NodeJS.Timeout | null = null;
    const enviar = () => {
      programado = null;
      if (!guardado) return;
      ultimoEnvio = Date.now();
      const cuadro = guardado;
      guardado = null;
      alCuadro(cuadro);
    };
    convertir.stdout.on("data", (d: Buffer) => {
      pendiente = Buffer.concat([pendiente, d]);
      const cuadros = partirJpeg(pendiente);
      pendiente = pendiente.subarray(ultimoFinDeJpeg(pendiente));
      if (cuadros.length === 0) return;
      guardado = Buffer.from(cuadros.at(-1)!.jpeg);
      const falta = INTERVALO_CUADRO_MS - (Date.now() - ultimoEnvio);
      if (falta <= 0) enviar();
      else programado ??= setTimeout(enviar, falta);
    });
    let errores = "";
    grabar.stderr.on("data", (d: Buffer) => (errores += d.toString()));
    convertir.stderr.on("data", (d: Buffer) => (errores += d.toString()));
    let terminado = false;
    const terminar = (motivo: string | null) => {
      if (terminado) return;
      terminado = true;
      if (programado) clearTimeout(programado);
      if (silencio) clearTimeout(silencio);
      grabar.kill("SIGKILL");
      convertir.kill("SIGKILL");
      this.capturas.delete(grabar);
      this.capturas.delete(convertir);
      alTerminar(motivo);
    };
    grabar.on("close", () => terminar(errores.trim() ? errores.trim().slice(0, 300) : "El teléfono dejó de transmitir."));
    convertir.on("close", () => terminar(null));
    grabar.on("error", (e) => terminar(e.message));
    convertir.on("error", (e) => terminar(`ffmpeg: ${e.message}`));
    return () => terminar(null);
  }

  /**
   * Una shell de adb abierta por teléfono para los toques: lanzar `adb shell`
   * por cada uno costaba ~140 ms y así cuesta ~80 (lo demás es el propio
   * `input`). Los comandos van en fila y cada uno espera su marca de fin.
   */
  private readonly shells = new Map<string, Shell>();
  private shell(serial: string): Shell {
    let sh = this.shells.get(serial);
    if (!sh || !sh.viva) {
      if (!this.adb) throw new Error("No se encontró adb.");
      sh = this.abrirShell(this.adb, serial);
      this.shells.set(serial, sh);
    }
    return sh;
  }

  /** Un toque o un deslizamiento, en coordenadas relativas (0..1) de la pantalla. */
  async tocar(serial: string, x: number, y: number): Promise<void> {
    const { ancho, alto } = await this.tamanoGuardado(serial);
    await this.shell(serial).correr(`input tap ${Math.round(x * ancho)} ${Math.round(y * alto)}`);
  }

  async deslizar(serial: string, desde: { x: number; y: number }, hasta: { x: number; y: number }, ms: number): Promise<void> {
    const { ancho, alto } = await this.tamanoGuardado(serial);
    const d = Math.max(50, Math.min(2_000, Math.round(ms)));
    await this.shell(serial).correr(
      `input swipe ${Math.round(desde.x * ancho)} ${Math.round(desde.y * alto)} ${Math.round(hasta.x * ancho)} ${Math.round(hasta.y * alto)} ${d}`,
    );
  }

  async tecla(serial: string, tecla: keyof typeof TECLAS): Promise<void> {
    const espejo = this.espejoVivo(serial);
    if (espejo) {
      espejo.enviar(mensajeTecla(0, TECLAS[tecla]));
      espejo.enviar(mensajeTecla(1, TECLAS[tecla]));
      return;
    }
    await this.shell(serial).correr(`input keyevent ${TECLAS[tecla]}`);
  }

  /**
   * Texto para el campo con foco. `input text` sólo escribe ASCII (una tilde
   * o una eñe no llegan) y no acepta espacios: van como `%s`. Todo lo demás
   * que no sea letra o número va escapado para la shell del teléfono.
   */
  async escribir(serial: string, texto: string): Promise<{ omitidos: boolean }> {
    // Con scrcpy el texto va en UTF-8 y llegan las tildes; por adb, sólo ASCII.
    const espejo = this.espejoVivo(serial);
    if (espejo) {
      espejo.enviar(mensajeTexto(texto));
      return { omitidos: Buffer.byteLength(texto, "utf8") > MAX_TEXTO };
    }
    const limpio = texto.replace(/[^\x20-\x7E]/g, "");
    if (limpio) {
      const escapado = limpio.replace(/ /g, "%s").replace(/[^A-Za-z0-9%]/g, (c) => `\\${c}`);
      await this.shell(serial).correr(`input text ${escapado}`);
    }
    return { omitidos: limpio.length !== texto.length };
  }

  private readonly tamanos = new Map<string, { ancho: number; alto: number }>();
  private async tamanoGuardado(serial: string) {
    const guardado = this.tamanos.get(serial);
    if (guardado) return guardado;
    const t = await this.tamano(serial);
    this.tamanos.set(serial, t);
    return t;
  }

  /**
   * Lo que hay en pantalla, del árbol de accesibilidad (`uiautomator dump`): es
   * el DOM de una app nativa. Tarda un par de segundos, por eso se lee una vez
   * al entrar en modo selección y el resaltado se calcula en el navegador.
   */
  async arbol(serial: string): Promise<{ ancho: number; alto: number; nodos: NodoDePantalla[] }> {
    const { salida, codigo } = await this.deAdb(["-s", serial, "exec-out", "uiautomator", "dump", "--compressed", "/dev/tty"], 20_000);
    const xml = salida.slice(0, salida.lastIndexOf("</hierarchy>") + "</hierarchy>".length);
    if (codigo !== 0 || !xml.includes("<hierarchy")) throw new Error(`No se pudo leer la pantalla: ${salida.trim().slice(0, 200)}`);
    const { ancho, alto } = await this.tamanoGuardado(serial);
    return { ancho, alto, nodos: parsearArbol(xml, ancho, alto) };
  }

  // --- Para la depuración (`depuracion-movil.ts`) -----------------------------------

  /** Un comando de adb contra un teléfono, con su salida como texto. Quien llama ya validó los argumentos. */
  async adbTexto(serial: string, args: string[], corteMs = CORTE_ADB_MS): Promise<{ codigo: number; salida: string }> {
    return this.deAdb(["-s", serial, ...args], corteMs);
  }

  /** Lo mismo con la salida en bytes: un archivo, una captura. */
  adbBinario(serial: string, args: string[], corteMs = 60_000): Promise<Buffer> {
    if (!this.adb) return Promise.reject(new Error("No se encontró adb."));
    const adb = this.adb;
    return new Promise((resolver, rechazar) =>
      execFile(adb, ["-s", serial, ...args], { encoding: "buffer", maxBuffer: 256 * 1024 * 1024, timeout: corteMs }, (error, stdout, stderr) =>
        error ? rechazar(new Error(String(stderr).trim() || error.message)) : resolver(stdout),
      ),
    );
  }

  /**
   * El teléfono sobre el que depurar una app: el que la tiene abierta desde
   * este repo; si no, el único conectado. Con varios y ninguno elegido, se
   * pide que alguien la abra desde el IDE (así se sabe cuál es).
   */
  async telefonoPara(repoId: string): Promise<{ ok: true; serial: string } | { ok: false; motivo: string }> {
    if (!this.adb) return { ok: false, motivo: "No hay adb en esta máquina: sin Android Studio (o las platform-tools) no se puede hablar con un teléfono." };
    const listos = (await this.listar()).filter((d) => d.estado === "device");
    if (listos.length === 0) {
      return { ok: false, motivo: "No hay ningún teléfono conectado. Una persona lo vincula por QR desde la pestaña Código → Mobile → Dispositivos." };
    }
    const delRepo = listos.find((d) => this.destinos.get(ipDe(d.serial))?.repoId === repoId);
    if (delRepo) return { ok: true, serial: delRepo.serial };
    if (listos.length === 1) return { ok: true, serial: listos[0]!.serial };
    return { ok: false, motivo: "Hay varios teléfonos conectados y ninguno tiene abierta esta app: que una persona la abra desde la pestaña Mobile." };
  }

  instalacion(clave: string): Instalacion | null {
    return this.instalaciones.get(clave) ?? null;
  }

  /**
   * Compila la build de desarrollo sobre la carpeta de la app en la sesión y
   * la instala. Hace falta cada vez que cambia algo nativo (una dependencia con
   * código nativo, un plugin en app.json); lo demás llega del Metro. Siempre
   * pasa por `expo prebuild` (queda en la sesión; en un proyecto de Expo
   * `android/` está en el `.gitignore`).
   */
  instalar(clave: string, serial: string, carpeta: string, tmp: string): Instalacion {
    const previa = this.instalaciones.get(clave);
    if (previa?.estado === "instalando") return previa;
    const inst: Instalacion = { estado: "instalando", lineas: [], desde: Date.now() };
    this.instalaciones.set(clave, inst);
    const anotar = (texto: string) => {
      for (const linea of texto.split("\n")) {
        if (!linea.trim()) continue;
        inst.lineas.push(linea);
      }
      if (inst.lineas.length > MAX_LINEAS) inst.lineas.splice(0, inst.lineas.length - MAX_LINEAS);
    };
    void (async () => {
      const java = await detectarJava(this.correr);
      if (!java) throw new Error("No hay un JDK 17: instalá Android Studio o `brew install openjdk@17`.");
      const abi = (await this.deAdb(["-s", serial, "shell", "getprop", "ro.product.cpu.abi"])).salida.trim() || "arm64-v8a";
      const sdk = this.adb ? join(this.adb, "..", "..") : undefined;
      const env: NodeJS.ProcessEnv = {
        ...entornoDeComando(process.env, tmp),
        JAVA_HOME: java,
        ...(sdk ? { ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk } : {}),
        ANDROID_SERIAL: serial,
        NODE_ENV: "development",
      };
      // Siempre, aunque `android/` ya exista: un módulo nativo nuevo (expo-camera)
      // o un plugin en app.json cambian el proyecto nativo, y compilar el
      // android/ viejo instala una build que no los trae —la app sigue usando
      // la cámara del sistema y nadie entiende por qué—. Sin --clean es
      // idempotente y rápido.
      anotar(`▸ ${existsSync(join(carpeta, "android")) ? "Actualizando" : "Generando"} el proyecto nativo (expo prebuild)…`);
      await correrEnVivo(["npx", "expo", "prebuild", "--platform", "android", "--no-install"], carpeta, env, anotar);
      anotar(`▸ Compilando e instalando la build de desarrollo (${abi})… la primera vez tarda unos minutos.`);
      await correrEnVivo(
        ["./gradlew", "app:installDebug", `-PreactNativeArchitectures=${abi}`, "--console=plain"],
        join(carpeta, "android"),
        env,
        anotar,
      );
      inst.estado = "listo";
      anotar("✓ Instalada. Abrila desde acá: el JavaScript lo baja del Metro de la sesión.");
    })().catch((error: unknown) => {
      inst.estado = "fallo";
      anotar(`✗ ${error instanceof Error ? error.message : String(error)}`);
    });
    return inst;
  }
}

export interface Shell {
  readonly viva: boolean;
  correr(comando: string): Promise<void>;
  cerrar(): void;
}

class ShellDeTelefono implements Shell {
  private readonly hijo: ChildProcess;
  private fila: Promise<void> = Promise.resolve();
  private salida = "";
  private esperando: { marca: string; resolver: () => void } | null = null;
  private n = 0;
  viva = true;

  constructor(adb: string, serial: string) {
    this.hijo = spawn(adb, ["-s", serial, "shell"], { stdio: ["pipe", "pipe", "pipe"] });
    const leer = (d: Buffer) => {
      this.salida += d.toString();
      if (this.esperando && this.salida.includes(this.esperando.marca)) {
        const { resolver } = this.esperando;
        this.esperando = null;
        this.salida = "";
        resolver();
      }
      if (this.salida.length > 64_000) this.salida = this.salida.slice(-4_000);
    };
    this.hijo.stdout!.on("data", leer);
    this.hijo.stderr!.on("data", leer);
    this.hijo.stdin!.on("error", () => {});
    this.hijo.on("close", () => {
      this.viva = false;
      this.esperando?.resolver();
      this.esperando = null;
    });
  }

  correr(comando: string): Promise<void> {
    const paso = this.fila.then(
      () =>
        new Promise<void>((resolver, rechazar) => {
          if (!this.viva) return rechazar(new Error("Se cortó la conexión con el teléfono."));
          const marca = `__orq_${++this.n}__`;
          const corte = setTimeout(() => {
            this.esperando = null;
            rechazar(new Error("El teléfono no contestó."));
          }, CORTE_ADB_MS);
          this.esperando = {
            marca,
            resolver: () => {
              clearTimeout(corte);
              resolver();
            },
          };
          this.hijo.stdin!.write(`${comando}; echo ${marca}\n`);
        }),
    );
    this.fila = paso.catch(() => {});
    return paso;
  }

  cerrar(): void {
    this.viva = false;
    this.hijo.kill("SIGKILL");
  }
}

export function correrEnVivo(
  argv: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  anotar: (texto: string) => void,
  corteMs = CORTE_INSTALAR_MS,
): Promise<void> {
  return new Promise((resolver, rechazar) => {
    const [ejecutable, ...resto] = argv;
    const hijo = spawn(ejecutable!, resto, { cwd, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    const corte = setTimeout(() => {
      try {
        process.kill(-hijo.pid!, "SIGKILL");
      } catch {
        // ya terminó
      }
    }, corteMs);
    hijo.stdout.on("data", (d: Buffer) => anotar(d.toString()));
    hijo.stderr.on("data", (d: Buffer) => anotar(d.toString()));
    hijo.on("error", (e) => {
      clearTimeout(corte);
      rechazar(e);
    });
    hijo.on("close", (codigo) => {
      clearTimeout(corte);
      if (codigo === 0) resolver();
      else rechazar(new Error(`${argv.slice(0, 2).join(" ")} terminó con código ${codigo}.`));
    });
  });
}

export const TECLAS = { atras: 4, inicio: 3, recientes: 187, enter: 66, borrar: 67, menu: 82, tab: 61 } as const;

export interface NodoDePantalla {
  /** Posición en el árbol: sirve de clave estable mientras no se vuelva a leer. */
  id: number;
  padre: number | null;
  clase: string;
  texto: string;
  descripcion: string;
  recurso: string;
  pulsable: boolean;
  /** En fracciones de la pantalla (0..1): la vista la dibuja a cualquier tamaño. */
  x: number;
  y: number;
  ancho: number;
  alto: number;
}

const entidades: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#10;": "\n" };
const decodificar = (s: string) => s.replace(/&(amp|lt|gt|quot|apos|#10);/g, (m) => entidades[m] ?? m);

/**
 * El XML de `uiautomator dump`, aplanado. Sólo quedan los nodos con algo que
 * los identifique (texto, descripción de accesibilidad, un `testID`) o que se
 * pueden tocar: los contenedores de maquetación no le dicen nada a nadie.
 */
export function parsearArbol(xml: string, ancho: number, alto: number): NodoDePantalla[] {
  const nodos: NodoDePantalla[] = [];
  const pila: Array<number | null> = [];
  let ultimoVisible: Array<number | null> = [];
  const patron = /<node\b([^>]*?)(\/?)>|<\/node>/g;
  let id = 0;
  for (const m of xml.matchAll(patron)) {
    if (m[0] === "</node>") {
      pila.pop();
      ultimoVisible.pop();
      continue;
    }
    const attrs = Object.fromEntries([...m[1]!.matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1]!, decodificar(a[2]!)]));
    const b = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(attrs.bounds ?? "");
    const padreVisible = ultimoVisible.at(-1) ?? null;
    let propio: number | null = padreVisible;
    if (b) {
      const [x1, y1, x2, y2] = [Number(b[1]), Number(b[2]), Number(b[3]), Number(b[4])];
      const texto = (attrs.text ?? "").trim();
      const descripcion = (attrs["content-desc"] ?? "").trim();
      const recurso = (attrs["resource-id"] ?? "").replace(/^.*:id\//, "");
      const pulsable = attrs.clickable === "true";
      // Los íconos de fuentes llegan como un carácter de uso privado: no son texto.
      const textoUtil = /^[\uE000-\uF8FF]+$/u.test(texto) ? "" : texto;
      if ((textoUtil || descripcion || recurso || pulsable) && x2 > x1 && y2 > y1) {
        propio = id++;
        nodos.push({
          id: propio,
          padre: padreVisible,
          clase: (attrs.class ?? "").split(".").at(-1) ?? "",
          texto: textoUtil,
          descripcion,
          recurso,
          pulsable,
          x: x1 / ancho,
          y: y1 / alto,
          ancho: (x2 - x1) / ancho,
          alto: (y2 - y1) / alto,
        });
      }
    }
    if (m[2] !== "/") {
      pila.push(propio);
      ultimoVisible.push(propio);
    }
  }
  ultimoVisible = [];
  return nodos;
}

/** Corta un buffer en JPEG completos (de FFD8 a FFD9). */
export function partirJpeg(buf: Buffer): Array<{ jpeg: Buffer }> {
  const cuadros: Array<{ jpeg: Buffer }> = [];
  let i = 0;
  for (;;) {
    const inicio = buf.indexOf(INICIO_JPEG, i);
    if (inicio < 0) break;
    const fin = buf.indexOf(FIN_JPEG, inicio + 2);
    if (fin < 0) break;
    cuadros.push({ jpeg: buf.subarray(inicio, fin + 2) });
    i = fin + 2;
  }
  return cuadros;
}

function ultimoFinDeJpeg(buf: Buffer): number {
  const fin = buf.lastIndexOf(FIN_JPEG);
  const inicio = buf.lastIndexOf(INICIO_JPEG);
  // Lo que queda después del último cuadro completo es el principio del siguiente.
  return inicio > fin ? inicio : fin >= 0 ? fin + 2 : 0;
}

const INICIO_JPEG = Buffer.from([0xff, 0xd8]);
const FIN_JPEG = Buffer.from([0xff, 0xd9]);

export interface DestinoDeTelefono {
  repoId: string;
  servicioId: string;
}

/** El 8081 del teléfono al Metro y cada puerto de los servicios al mismo de acá. */
export function tunelesPara(metro: number, puertos: number[]): Array<[number, number]> {
  return [[8081, metro], ...puertos.map((p): [number, number] => [p, p])];
}

const claveDeConexion = (d: Dispositivo) => `${d.serial}#${d.transporte ?? ""}`;

/** La IP de un serial inalámbrico (`192.168.1.37:38259`), o el serial tal cual si es USB. */
const ipDe = (serial: string) => (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(serial) ? serial.split(":")[0]! : serial);

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
