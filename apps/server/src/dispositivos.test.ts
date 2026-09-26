import { describe, expect, it } from "vitest";
import { Dispositivos, parsearArbol, parsearDispositivos, parsearMdns, partirJpeg, qrSvg, textoDeVinculo } from "./dispositivos.js";
import { limpiarCadena } from "./inspector-rn.js";

/**
 * El vínculo por QR sin teléfono: un `adb` falso que responde como el de
 * verdad. Lo que se fija es el protocolo —el QR lleva el nombre que el
 * teléfono anuncia después, y sólo ése se vincula— y que abrir la app tiende
 * los túneles antes de lanzarla.
 */

const DISPOSITIVOS = `List of devices attached
192.168.1.37:41417     device product:e1sxxx model:SM_S921B device:e1s transport_id:48
R58N123ABC             unauthorized usb:1-1 transport_id:3

`;

describe("dispositivos", () => {
  it("lee adb devices y mdns services", () => {
    expect(parsearDispositivos(DISPOSITIVOS)).toEqual([
      { serial: "192.168.1.37:41417", estado: "device", modelo: "SM S921B", inalambrico: true, transporte: "48" },
      { serial: "R58N123ABC", estado: "unauthorized", modelo: null, inalambrico: false, transporte: "3" },
    ]);
    const mdns = parsearMdns(
      "List of discovered mdns services\nadb-RFCX71E8H4K-pBHkW5\t_adb-tls-connect._tcp\t192.168.1.37:41417\norq-ab12cd34\t_adb-tls-pairing._tcp.\t192.168.1.37:37000\n",
    );
    expect(mdns).toEqual([
      { nombre: "adb-RFCX71E8H4K-pBHkW5", tipo: "_adb-tls-connect._tcp", direccion: "192.168.1.37:41417" },
      { nombre: "orq-ab12cd34", tipo: "_adb-tls-pairing._tcp", direccion: "192.168.1.37:37000" },
    ]);
  });

  it("el QR es el de la depuración inalámbrica de Android", () => {
    expect(textoDeVinculo("orq-ab12", "123456789")).toBe("WIFI:T:ADB;S:orq-ab12;P:123456789;;");
    expect(qrSvg(textoDeVinculo("orq-ab12", "123456789"))).toMatch(/^<svg[\s\S]*<\/svg>$/);
  });

  it("vincula sólo al teléfono que anuncia el nombre del QR, con su clave, y lo conecta", async () => {
    const llamadas: string[][] = [];
    let nombre = "";
    let vueltas = 0;
    const falso = async (argv: string[]) => {
      const args = argv.slice(1);
      llamadas.push(args);
      if (args[0] === "mdns") {
        vueltas++;
        // Otro teléfono vinculándose en la misma red: no es el nuestro.
        const lineas = ["ajeno-xyz\t_adb-tls-pairing._tcp\t192.168.1.50:40000"];
        if (vueltas >= 2) lineas.push(`${nombre}\t_adb-tls-pairing._tcp\t192.168.1.37:37000`);
        if (vueltas >= 3) lineas.push("adb-RFCX-x\t_adb-tls-connect._tcp\t192.168.1.37:41417");
        return { codigo: 0, salida: lineas.join("\n") };
      }
      if (args[0] === "pair") return { codigo: 0, salida: "Successfully paired to 192.168.1.37:37000 [guid=adb-RFCX]" };
      if (args[0] === "connect") return { codigo: 0, salida: "connected to 192.168.1.37:41417" };
      if (args[0] === "devices") return { codigo: 0, salida: DISPOSITIVOS };
      return { codigo: 0, salida: "" };
    };
    const d = new Dispositivos("/sdk/platform-tools/adb", falso);
    const v = d.vincular();
    expect(v.qr).toContain("<svg");
    // El nombre y la clave no se devuelven sueltos: sólo viajan en el QR.
    expect(JSON.stringify(v)).not.toMatch(/"clave"|"nombre"/);
    nombre = (d as unknown as { vinculos: Map<string, { nombre: string; clave: string }> }).vinculos.get(v.id)!.nombre;
    const clave = (d as unknown as { vinculos: Map<string, { clave: string }> }).vinculos.get(v.id)!.clave;
    for (let i = 0; i < 50 && d.vinculo(v.id)!.estado !== "listo"; i++) await new Promise((r) => setTimeout(r, 100));
    expect(d.vinculo(v.id)).toMatchObject({ estado: "listo", serial: "192.168.1.37:41417" });
    const pares = llamadas.filter((a) => a[0] === "pair");
    expect(pares).toEqual([["pair", "192.168.1.37:37000", clave]]);
    expect(llamadas).toContainEqual(["connect", "192.168.1.37:41417"]);
  }, 15_000);

  it("abrir tiende el 8081 al Metro y los puertos de los servicios antes de lanzar la app", async () => {
    const llamadas: string[][] = [];
    const d = new Dispositivos("/adb", async (argv) => {
      llamadas.push(argv.slice(1));
      return { codigo: 0, salida: "Events injected: 1" };
    });
    await d.abrir("SERIAL", { paquete: "co.codla.inspia", metro: 4401, puertos: [4300] });
    const sinSerial = llamadas.map((a) => a.slice(2).join(" "));
    expect(sinSerial.slice(0, 2)).toEqual(["reverse tcp:8081 tcp:4401", "reverse tcp:4300 tcp:4300"]);
    expect(sinSerial.at(-1)).toContain("monkey -p co.codla.inspia");
  });

  it("sin adb lo dice en vez de fallar lejos", async () => {
    const d = new Dispositivos(null);
    expect(d.disponible).toBe(false);
    expect(await d.listar()).toEqual([]);
    expect(() => d.vincular()).toThrow(/adb/);
  });
});

describe("espejo del teléfono", () => {
  const XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">
<node index="0" text="" class="android.widget.FrameLayout" content-desc="" clickable="false" bounds="[0,0][1080,2340]">
  <node index="0" text="" class="android.view.ViewGroup" content-desc="Ingresar" clickable="true" bounds="[66,1778][1014,1928]">
    <node index="0" text="Ingresar" class="android.widget.TextView" content-desc="" clickable="false" bounds="[450,1820][629,1885]" />
  </node>
  <node index="1" text="&#xf196;" class="android.widget.TextView" content-desc="" clickable="false" bounds="[66,1100][114,1150]" />
  <node index="2" text="Correo &amp; clave" resource-id="co.codla.inspia:id/correo" class="android.widget.EditText" clickable="true" bounds="[66,1175][1014,1319]" />
</node></hierarchy>`;

  it("aplana el árbol de accesibilidad: sin contenedores ni íconos de fuente, con padres y fracciones", () => {
    const nodos = parsearArbol(XML.replace("&#xf196;", "\uf196"), 1080, 2340);
    expect(nodos.map((n) => [n.id, n.padre, n.clase, n.texto, n.descripcion, n.recurso])).toEqual([
      [0, null, "ViewGroup", "", "Ingresar", ""],
      [1, 0, "TextView", "Ingresar", "", ""],
      [2, null, "EditText", "Correo & clave", "", "correo"],
    ]);
    expect(nodos[0]!.x).toBeCloseTo(66 / 1080);
    expect(nodos[0]!.alto).toBeCloseTo(150 / 2340);
  });

  it("corta JPEG completos y deja el resto para el próximo pedazo", () => {
    const a = Buffer.from([0xff, 0xd8, 1, 2, 0xff, 0xd9]);
    const b = Buffer.from([0xff, 0xd8, 3, 0xff, 0xd9]);
    const cuadros = partirJpeg(Buffer.concat([Buffer.from([9]), a, b, Buffer.from([0xff, 0xd8, 7])]));
    expect(cuadros.map((c) => [...c.jpeg])).toEqual([[...a], [...b]]);
  });

  it("de la cadena de fibras quedan los componentes propios y la pantalla de expo-router", () => {
    expect(
      limpiarCadena(["Text", "View", "Pressable", "ScrollView", "LoginScreen(./login.tsx)", "WrappedScreenComponent", "Route(login)", "AuthGate", "SafeAreaProviderCompat"]),
    ).toEqual({ componentes: ["LoginScreen", "AuthGate"], pantallas: ["./login.tsx"] });
  });

  it("escribir escapa para la shell del teléfono y avisa lo que adb no puede tipear", async () => {
    const comandos: string[] = [];
    const d = new Dispositivos("/adb", async () => ({ codigo: 0, salida: "" }), () => ({
      viva: true,
      correr: async (c: string) => void comandos.push(c),
      cerrar() {},
    }));
    expect(await d.escribir("S", "hola; rm -rf ñandú")).toEqual({ omitidos: true });
    expect(comandos).toEqual(["input text hola\\;%srm%s\\-rf%sand"]);
  });

  it("si el teléfono vuelve con otro puerto o el Metro cambia de puerto, los túneles se corrigen solos", async () => {
    let conexion = "192.168.1.37:41417";
    let transporte = 7;
    let metro = 4401;
    const reverses: string[] = [];
    const d = new Dispositivos("/adb", async (argv) => {
      const args = argv.slice(1);
      if (args[0] === "devices") return { codigo: 0, salida: `List of devices attached\n${conexion}\tdevice model:SM_S921B transport_id:${transporte}\n` };
      if (args[0] === "mdns") return { codigo: 0, salida: "" };
      if (args[2] === "reverse") reverses.push(`${args[1]} ${args[3]}>${args[4]}`);
      return { codigo: 0, salida: "Events injected: 1" };
    });
    d.mantenerTuneles(() => [
      [8081, metro],
      [4300, 4300],
    ]);
    await d.abrir(conexion, { paquete: "co.codla.inspia", metro, puertos: [4300], destino: { repoId: "r", servicioId: "mobile" } });
    reverses.length = 0;

    await d.listar();
    expect(reverses).toEqual([]); // ya estaban tendidos: no se repiten

    conexion = "192.168.1.37:38259"; // la depuración inalámbrica volvió en otro puerto
    transporte = 8;
    await d.listar();
    expect(reverses).toEqual(["192.168.1.37:38259 tcp:8081>tcp:4401", "192.168.1.37:38259 tcp:4300>tcp:4300"]);

    // adb la reconectó solo, con el mismo serial, entre dos consultas: otra conexión, túneles perdidos.
    reverses.length = 0;
    transporte = 9;
    await d.listar();
    expect(reverses).toEqual(["192.168.1.37:38259 tcp:8081>tcp:4401", "192.168.1.37:38259 tcp:4300>tcp:4300"]);

    reverses.length = 0;
    metro = 4402; // se reinició el servicio y el Metro quedó en otro puerto
    await d.listar();
    expect(reverses).toEqual(["192.168.1.37:38259 tcp:8081>tcp:4402", "192.168.1.37:38259 tcp:4300>tcp:4300"]);
    d.detenerCapturas();
  });
});
