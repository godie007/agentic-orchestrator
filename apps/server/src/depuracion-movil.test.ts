import { describe, expect, it } from "vitest";
import { lineasDeLaApp, paqueteEnPrimerPlano, taparSecretos, uidDe, ultimasFallas, validarDiagnostico, validarRutaDeApp, validarSqlDeLectura } from "./depuracion-movil.js";

/**
 * Las reglas que deciden hasta dónde llega un agente en el teléfono de una
 * persona. Cada caso rechazado acá es algo que un shell libre permitía.
 */

const APP = "co.codla.inspia";

describe("depuración del teléfono", () => {
  it("las rutas quedan adentro del sandbox de la app", () => {
    expect(validarRutaDeApp("files/SQLite/inspia.db")).toEqual({ ok: true, ruta: "files/SQLite/inspia.db" });
    expect(validarRutaDeApp("./shared_prefs/")).toEqual({ ok: true, ruta: "shared_prefs" });
    expect(validarRutaDeApp("")).toEqual({ ok: true, ruta: "." });
    expect(validarRutaDeApp("/sdcard/DCIM").ok).toBe(false);
    expect(validarRutaDeApp("files/../../com.whatsapp").ok).toBe(false);
    // Nada que la shell del teléfono interprete: la ruta viaja sin comillas.
    expect(validarRutaDeApp("files; rm -rf .").ok).toBe(false);
    expect(validarRutaDeApp("files/$(id)").ok).toBe(false);
  });

  it("sólo SQL de lectura, una sentencia y nada del cliente sqlite3", () => {
    expect(validarSqlDeLectura("SELECT status, count(*) FROM outbox GROUP BY status;")).toEqual({
      ok: true,
      sql: "SELECT status, count(*) FROM outbox GROUP BY status",
    });
    expect(validarSqlDeLectura("with x as (select 1) select * from x").ok).toBe(true);
    expect(validarSqlDeLectura("PRAGMA table_info(outbox)").ok).toBe(true);
    expect(validarSqlDeLectura("DELETE FROM outbox").ok).toBe(false);
    expect(validarSqlDeLectura("select 1; drop table outbox").ok).toBe(false);
    expect(validarSqlDeLectura(".shell id").ok).toBe(false);
    expect(validarSqlDeLectura("PRAGMA journal_mode = DELETE").ok).toBe(false);
    expect(validarSqlDeLectura("select * from x where 1 or attach").ok).toBe(false);
  });

  it("los diagnósticos van atados a la app y nada más", () => {
    expect(validarDiagnostico("dumpsys meminfo", APP)).toEqual({ ok: true, argv: ["dumpsys", "meminfo", APP] });
    expect(validarDiagnostico(`adb shell dumpsys gfxinfo ${APP} framestats`, APP)).toEqual({ ok: true, argv: ["dumpsys", "gfxinfo", APP, "framestats"] });
    expect(validarDiagnostico("getprop ro.build.version.release", APP).ok).toBe(true);
    expect(validarDiagnostico("settings get global adb_wifi_enabled", APP).ok).toBe(true);
    // Lo que expone a la persona o toca otras apps, no.
    expect(validarDiagnostico("dumpsys notification", APP).ok).toBe(false);
    expect(validarDiagnostico("dumpsys meminfo com.whatsapp", APP).ok).toBe(false);
    expect(validarDiagnostico("settings get secure android_id", APP).ok).toBe(false);
    expect(validarDiagnostico("pm uninstall com.whatsapp", APP).ok).toBe(false);
    expect(validarDiagnostico("content query --uri content://sms/inbox", APP).ok).toBe(false);
    expect(validarDiagnostico("getprop; rm -rf /sdcard", APP).ok).toBe(false);
    expect(validarDiagnostico("dumpsys meminfo `id`", APP).ok).toBe(false);
  });

  it("tapa las credenciales que pasan por los logs", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const log = `Authorization: Bearer ${jwt} url=https://x.co/rest?apikey=sb_publishable_abc123&x=1 sb_secret_zzz`;
    const tapado = taparSecretos(log);
    expect(tapado).not.toContain(jwt);
    expect(tapado).not.toContain("sb_secret_zzz");
    expect(tapado).not.toContain("sb_publishable_abc123");
    expect(tapado).toContain("x=1");
  });

  it("lee el uid y la app al frente sin nombrar otras", () => {
    expect(uidDe("package:co.codla.inspia uid:10582\n")).toBe(10582);
    expect(uidDe("")).toBeNull();
    expect(paqueteEnPrimerPlano("  topResumedActivity=ActivityRecord{abc u0 co.codla.inspia/.MainActivity t123}")).toBe(APP);
    expect(paqueteEnPrimerPlano("  mResumedActivity: ActivityRecord{abc u0 com.whatsapp/.Main t9}")).toBe("com.whatsapp");
  });

  it("de un logcat -v uid quedan sólo las líneas de la app, desde el nivel pedido y sin el uid", () => {
    const salida = [
      "--------- beginning of main",
      "09-25 20:44:53.996 10582 12122 12122 I VRI[MainActivity]: visible",
      "09-25 20:44:54.100 10053 3000 3001 I WhatsApp: mensaje de otra app",
      "09-25 20:44:54.200 10582 12122 12279 D HWUI: detalle",
      "09-25 20:44:54.300 10582 4260 4634 E libc: Fatal signal 11 del proceso anterior",
    ].join("\n");
    expect(lineasDeLaApp(salida, 10582, "I")).toEqual([
      "09-25 20:44:53.996 12122 12122 I VRI[MainActivity]: visible",
      "09-25 20:44:54.300 4260 4634 E libc: Fatal signal 11 del proceso anterior",
    ]);
    expect(lineasDeLaApp(salida, 10582, "V")).toHaveLength(3);
    expect(lineasDeLaApp(salida, 10582, "V").join()).not.toContain("WhatsApp");
  });

  it("cada crash se muestra desde su comienzo, no por la cola del backtrace", () => {
    const falla = (hora: string) => [
      `09-25 ${hora} 4260 4634 F libc    : Fatal signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0x0 in tid 4634 (mqt_v_js)`,
      `09-25 ${hora} 13507 13507 F DEBUG   : *** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***`,
      `09-25 ${hora} 13507 13507 F DEBUG   : Cause: null pointer dereference`,
      ...Array.from({ length: 80 }, (_, i) => `09-25 ${hora} 13507 13507 F DEBUG   :       #${i} pc 0000 /apex/libart.so`),
    ];
    const r = ultimasFallas(["--------- beginning of crash", ...falla("19:35:52.033"), ...falla("20:16:59.382")].join("\n"), 3, 10);
    expect(r).toHaveLength(2);
    expect(r[1]).toMatch(/^09-25 20:16:59.382 .*Fatal signal 11/);
    expect(r[1]).toContain("Cause: null pointer dereference");
    expect(r[1]).toContain("líneas más del backtrace");
  });
});

describe("consola de JavaScript de la app (depurador de Hermes)", () => {
  it("guarda console.* y las excepciones con su stack", async () => {
    const { ConsolaJs } = await import("./inspector-rn.js");
    const c = new ConsolaJs(1);
    c.recibir(JSON.stringify({ method: "Runtime.consoleAPICalled", params: { type: "log", args: [{ type: "string", value: "sincronizando" }, { type: "number", value: 3 }] } }));
    c.recibir(
      JSON.stringify({
        method: "Runtime.consoleAPICalled",
        params: { type: "error", args: [{ type: "string", value: "Falló la subida" }], stackTrace: { callFrames: [{ functionName: "subirFoto" }] } },
      }),
    );
    c.recibir(JSON.stringify({ method: "Runtime.exceptionThrown", params: { exceptionDetails: { text: "Uncaught", exception: { description: "TypeError: Cannot read property 'map' of undefined\n    at FotoGrid" } } } }));
    c.recibir("no es json");
    const e = (c as unknown as { entradas: Array<{ nivel: string; texto: string }> }).entradas;
    expect(e.map((x) => [x.nivel, x.texto])).toEqual([
      ["log", "sincronizando 3"],
      ["error", "Falló la subida  (en subirFoto)"],
      ["excepcion", "TypeError: Cannot read property 'map' of undefined\n    at FotoGrid"],
    ]);
  });
});
