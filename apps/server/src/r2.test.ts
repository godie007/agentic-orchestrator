import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { repositorioSchema, servicioSchema } from "@orq/shared";
import { credencialesR2, crearR2Storage, detectarContenido, firmarS3, parsearListado } from "./r2.js";

/**
 * R2 para verificar lo subido. Lo que se fija acá: que la firma sea la de S3
 * (sin SDK, un error de un carácter es un 403 para siempre), que el tipo real
 * salga de los bytes y no de lo que declaró quien subió, y que las llaves no
 * salgan nunca del servidor.
 */

const AWS = { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1" };

describe("firmarS3 (vectores de la documentación de SigV4 para S3)", () => {
  const fecha = new Date("2013-05-24T00:00:00Z");

  it("GET de un objeto con Range", () => {
    const h = firmarS3({ metodo: "GET", host: "examplebucket.s3.amazonaws.com", ruta: "/test.txt", query: {}, cabeceras: { Range: "bytes=0-9" }, fecha, ...AWS });
    expect(h.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });

  it("listado con query ordenada", () => {
    const h = firmarS3({ metodo: "GET", host: "examplebucket.s3.amazonaws.com", ruta: "/", query: { "max-keys": "2", prefix: "J" }, fecha, ...AWS });
    expect(h.authorization).toContain("Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7");
  });
});

describe("lo que se lee de R2", () => {
  it("el listado, con carpetas y el token para seguir", () => {
    const xml = `<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>tok&amp;1</NextContinuationToken>
      <Contents><Key>projects/p1/a.jpg</Key><LastModified>2026-09-26T12:00:00.000Z</LastModified><Size>2048</Size></Contents>
      <Contents><Key>projects/p1/b.jpg</Key><LastModified>2026-09-26T12:01:00.000Z</LastModified><Size>0</Size></Contents>
      <CommonPrefixes><Prefix>projects/p1/visitas/</Prefix></CommonPrefixes></ListBucketResult>`;
    const l = parsearListado(xml);
    expect(l.objetos).toEqual([
      { clave: "projects/p1/a.jpg", tamano: 2048, modificado: "2026-09-26T12:00:00.000Z" },
      { clave: "projects/p1/b.jpg", tamano: 0, modificado: "2026-09-26T12:01:00.000Z" },
    ]);
    expect(l.carpetas).toEqual(["projects/p1/visitas/"]);
    expect(l.siguiente).toBe("tok&1");
  });

  it("el tipo real sale de los primeros bytes", () => {
    expect(detectarContenido(Buffer.from("ffd8ffe000104a464946", "hex"))).toBe("image/jpeg");
    expect(detectarContenido(Buffer.from("89504e470d0a1a0a0000", "hex"))).toBe("image/png");
    expect(detectarContenido(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]))).toBe("image/webp");
    expect(detectarContenido(Buffer.concat([Buffer.alloc(4), Buffer.from("ftypheic")]))).toBe("image/heic");
    expect(detectarContenido(Buffer.from("%PDF-1.7"))).toBe("application/pdf");
    expect(detectarContenido(Buffer.from("<html>"))).toBeNull();
  });

  it("credenciales: el endpoint sale de la cuenta si no está, y se nombra lo que falta", () => {
    const c = credencialesR2({ R2_ACCOUNT_ID: "abc", R2_BUCKET: "b", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s" });
    expect(c.ok && c.cred.endpoint).toBe("https://abc.r2.cloudflarestorage.com");
    expect(c.ok && c.cred.region).toBe("auto");
    expect(credencialesR2({ R2_BUCKET: "b" })).toEqual({ ok: false, faltan: ["R2_ENDPOINT (o R2_ACCOUNT_ID)", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"] });
  });
});

describe("crearR2Storage", () => {
  let dir: string;
  const guardados: string[] = [];
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "orq-r2-"));
    guardados.length = 0;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });

  const repoCon = (env: string, marcadores: string[] = []) => {
    writeFileSync(join(dir, ".env"), env);
    const api = servicioSchema.parse({ id: "srv_api", nombre: "Backend", carpeta: "backend", tipo: "api", comando: "npm run dev", archivosEntorno: [join(dir, ".env")] });
    const movil = servicioSchema.parse({ id: "srv_mov", nombre: "Mobile", carpeta: "mobile", tipo: "movil", comando: "npx expo start", marcadoresProduccion: marcadores });
    return repositorioSchema.parse({
      id: "rep_1",
      companyId: "cmp_1",
      nombre: "INSPIA",
      slug: "inspia",
      origen: { tipo: "local", ruta: dir },
      ramaBase: "dev",
      servicios: [movil, api],
      createdAt: 0,
      updatedAt: 0,
    });
  };
  const ENV = "R2_ENDPOINT=https://cuenta.r2.cloudflarestorage.com\nR2_BUCKET=inspia-files\nR2_ACCESS_KEY_ID=AKID\nR2_SECRET_ACCESS_KEY=supersecreto123\nSUPABASE_URL=https://staging.supabase.co\n";

  it("verifica un lote: lo que falta, lo vacío y lo que miente su tipo; nunca devuelve las llaves", async () => {
    const pedidos: Array<{ url: string; metodo: string; auth: string }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const h = init.headers as Record<string, string>;
      pedidos.push({ url, metodo: init.method ?? "GET", auth: h.authorization ?? "" });
      const clave = decodeURIComponent(new URL(url).pathname.replace("/inspia-files/", ""));
      if (clave === "falta.jpg") return new Response(null, { status: 404 });
      const tamano = clave === "vacia.jpg" ? 0 : 1000;
      if (init.method === "HEAD") return new Response(null, { status: 200, headers: { "content-length": String(tamano), "content-type": "image/jpeg", "last-modified": "Sat, 26 Sep 2026 12:00:00 GMT", "x-amz-meta-client-id": "abc" } });
      const bytes = clave === "png.jpg" ? Buffer.from("89504e470d0a1a0a", "hex") : Buffer.from("ffd8ffe0", "hex");
      return new Response(bytes, { status: 206 });
    });
    const s = crearR2Storage({ repos: () => [repoCon(ENV)], guardarEnSalida: async (n, c) => (guardados.push(n), `${c}/${n}`) });
    const r = await s.objetos(undefined, ["ok.jpg", "falta.jpg", "vacia.jpg", "png.jpg"], { guardar: true });

    expect(r.ok).toBe(true);
    const texto = r.ok ? r.texto : "";
    expect(texto).toMatch(/✅ ok\.jpg: 1000 B, image\/jpeg \(contenido: image\/jpeg\)/);
    expect(texto).toMatch(/client-id=abc/);
    expect(texto).toMatch(/❌ falta\.jpg: NO EXISTE/);
    expect(texto).toMatch(/vacia\.jpg[\s\S]*VACÍO/);
    expect(texto).toMatch(/declara image\/jpeg pero el contenido es image\/png/);
    expect(guardados).toEqual(["ok.jpg", "png.jpg"]);
    expect(texto).not.toContain("supersecreto123");
    expect(texto).not.toContain("AKID");
    expect(pedidos[0]!.url).toBe("https://cuenta.r2.cloudflarestorage.com/inspia-files/ok.jpg");
    expect(pedidos.every((p) => p.auth.startsWith("AWS4-HMAC-SHA256 Credential=AKID/"))).toBe(true);
  });

  it("no consulta si el entorno apunta a producción (por los marcadores del repo)", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const s = crearR2Storage({ repos: () => [repoCon(ENV.replace("staging.supabase.co", "qnfeqicedlysxredgzid.supabase.co"), ["qnfeqicedlysxredgzid"])], guardarEnSalida: async () => "" });
    const r = await s.listar(undefined, { prefijo: "", limite: 10, carpetas: true });
    expect(r.ok === false && r.motivo).toMatch(/producción \(SUPABASE_URL\)/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sin credenciales dice cuáles faltan y dónde van", async () => {
    const s = crearR2Storage({ repos: () => [repoCon("R2_BUCKET=inspia-files\n")], guardarEnSalida: async () => "" });
    const r = await s.listar(undefined, { prefijo: "", limite: 10, carpetas: false });
    expect(r.ok === false && r.motivo).toMatch(/R2_ACCESS_KEY_ID/);
  });
});
