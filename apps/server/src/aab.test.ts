import { describe, expect, it } from "vitest";
import { parsearCertificado, parsearManifiestoProto, siguienteVersion, subirVersionEnAppJson, verificarBundle } from "./aab.js";

/**
 * Lo que decide si un AAB se puede subir a Play, sin compilar nada: la versión
 * que se escribe, cómo se lee el manifiesto de un bundle y qué cuenta como un
 * bundle que apunta a producción.
 */

// Un codificador mínimo de protobuf para armar un manifiesto como el de aapt2.
const varint = (n: number): number[] => {
  const bytes: number[] = [];
  do {
    let b = n & 0x7f;
    n = Math.floor(n / 128);
    if (n > 0) b |= 0x80;
    bytes.push(b);
  } while (n > 0);
  return bytes;
};
const campo = (n: number, valor: Buffer | string) => {
  const b = Buffer.isBuffer(valor) ? valor : Buffer.from(valor);
  return Buffer.from([...varint(n * 8 + 2), ...varint(b.length), ...b]);
};
const atributo = (nombre: string, valor: string) => campo(4, Buffer.concat([campo(1, "http://schemas.android.com/apk/res/android"), campo(2, nombre), campo(3, valor)]));
const elemento = (nombre: string, attrs: Buffer[], hijos: Buffer[] = []) =>
  Buffer.concat([campo(3, nombre), ...attrs, ...hijos.map((h) => campo(5, campo(1, h)))]);

describe("AAB de producción", () => {
  it("sugiere la versión siguiente", () => {
    expect(siguienteVersion("1.0.18")).toBe("1.0.19");
    expect(siguienteVersion("2.3")).toBe("2.3");
  });

  it("sube versión y versionCode sin reformatear app.json", () => {
    const texto = `{
  "expo": {
    "name": "INSPIA",
    "version": "1.0.18",
    "plugins": [["expo-build-properties", { "android": { "version": "34" } }]],
    "android": {
      "package": "co.codla.inspia",
      "versionCode": 20
    }
  }
}
`;
    const nuevo = subirVersionEnAppJson(texto, "1.0.19", 21);
    const obj = JSON.parse(nuevo) as { expo: { version: string; android: { versionCode: number }; plugins: unknown } };
    expect(obj.expo.version).toBe("1.0.19");
    expect(obj.expo.android.versionCode).toBe(21);
    // El "version" de un plugin no se toca, y el diff son dos líneas.
    expect(JSON.stringify(obj.expo.plugins)).toContain('"version":"34"');
    const distintas = nuevo.split("\n").filter((l, i) => l !== texto.split("\n")[i]);
    expect(distintas).toEqual(['    "version": "1.0.19",', '      "versionCode": 21']);
  });

  it("lee paquete, versión y permisos del manifiesto protobuf de un AAB", () => {
    const manifiesto = campo(
      1,
      elemento(
        "manifest",
        [atributo("versionCode", "21"), atributo("versionName", "1.0.19"), atributo("package", "co.codla.inspia")],
        [
          elemento("uses-permission", [atributo("name", "android.permission.CAMERA")]),
          elemento("uses-permission", [atributo("name", "android.permission.INTERNET")]),
          elemento("application", [atributo("label", "INSPIA")]),
        ],
      ),
    );
    expect(parsearManifiestoProto(manifiesto)).toEqual({
      paquete: "co.codla.inspia",
      versionCode: 21,
      versionName: "1.0.19",
      permisos: ["android.permission.CAMERA", "android.permission.INTERNET"],
    });
  });

  it("lee el certificado de keytool y reconoce la clave de depuración", () => {
    const sha = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, "0").toUpperCase()).join(":");
    const c = parsearCertificado(`Signer #1:\n\nCertificate #1:\nOwner: CN=Android Debug, O=Android, C=US\nIssuer: CN=Android Debug\n\t SHA256: ${sha}\n`);
    expect(c).toEqual({ propietario: "CN=Android Debug, O=Android, C=US", sha256: sha });
    expect(parsearCertificado("jar is unsigned.")).toBeNull();
  });

  it("un bundle con staging o con URLs de la vista previa no pasa", () => {
    const prod = { EXPO_PUBLIC_API_URL: "https://inspia.codla.co/api", EXPO_PUBLIC_SUPABASE_URL: "https://prod.supabase.co", SENTRY_ORG: "codla" };
    const dev = { EXPO_PUBLIC_API_URL: "https://inspia-staging.codla.co/api", EXPO_PUBLIC_SUPABASE_URL: "https://prod.supabase.co" };
    const bien = verificarBundle(Buffer.from('a="https://inspia.codla.co/api";b="https://prod.supabase.co"'), prod, dev);
    expect(bien.every((v) => v.ok === true)).toBe(true);

    const staging = verificarBundle(Buffer.from('a="https://inspia-staging.codla.co/api";b="https://prod.supabase.co"'), prod, dev);
    expect(staging.map((v) => v.ok)).toEqual([false, false, true]);
    // Nunca se muestran los valores: sólo los nombres.
    expect(JSON.stringify(staging)).not.toContain("inspia-staging");

    const local = verificarBundle(Buffer.from('a="https://inspia.codla.co/api";b="https://prod.supabase.co";c="http://127.0.0.1:4300/api"'), prod, dev);
    expect(local.at(-1)?.ok).toBe(false);
  });
});
