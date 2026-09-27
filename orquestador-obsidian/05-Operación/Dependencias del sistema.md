---
tags: [operación, plataforma]
aliases: [Dependencias, Requisitos del sistema, ffmpeg, Kokoro, adb, scrcpy, JDK, sandbox-exec, buscarChrome, detectarAdb, detectarJava, detectarScrcpy, hayAislamiento]
---

# Dependencias del sistema

Los programas de la máquina que usa el orquestador, además de Node. La regla que
los gobierna es la misma en todos: **usar lo que hay y degradar con aviso**. No se
instala ningún navegador, SDK de voz ni cliente de S3; y una habilidad que no se
puede cumplir **no se registra**, porque ofrecerle al agente una herramienta que
siempre falla le hace gastar turnos intentándola.

## Resumen

| Dependencia | Habilita | Cómo se detecta | Si falta |
|---|---|---|---|
| **git** | repos, sesiones, checkpoints, IDE | se invoca `git` del PATH | las funciones de código fallan con el error de git |
| **ffmpeg + ffprobe** (con libass) | los tres motores de video, `inspeccionar_medio`, `extraer_cuadros`, `musica:cama`, espejo de respaldo | se invocan por nombre, sin detección | `export_video` **se registra igual** y falla diciendo que falta ffmpeg |
| **Chrome / Chromium / Edge** | `export_video_estudio`, `revisar_lamina`, `grabar_clip`, `explorar_pantalla`, `export_video_clips` | `buscarChrome` | esas cinco **no se registran** |
| **Kokoro** (modelo local) | voz del video, gratis e ilimitada | `buscarKokoro` en cada render | cae a `say` |
| **`say`** (macOS) | voz de respaldo | se invoca por nombre | sin Kokoro ni `say` no hay voz y el export falla |
| **adb** (platform-tools) | celular: vínculo, espejo, depuración, QA | `detectarAdb` al crear el `Runtime` | las herramientas del teléfono **no se registran** |
| **scrcpy** | espejo fluido con toques en vivo | `detectarScrcpy`, una vez por proceso | respaldo `screenrecord` + ffmpeg |
| **JDK 17** | build de desarrollo, AAB/APK | `detectarJava` en cada build | "No hay un JDK 17" |
| **Android SDK + build-tools** | compilar, `aapt2`, `apksigner` | se deduce de la ruta de adb | "No se encontró el SDK" / sin APK |
| **`unzip`, `tar`, `keytool`** | verificar AAB | por nombre / `$JAVA_HOME/bin` | el build falla |
| **`sqlite3`** ≥ 3.37 | `consultar_base_de_la_app` | primero del PATH | la herramienta falla |
| **`sandbox-exec`** (macOS) | contener comandos y vistas previas | `hayAislamiento()` | comandos y servicios se niegan salvo `sinAislamiento` |
| **`cp -c`** (APFS) | clonar `node_modules` sin ocupar disco | por plataforma | copia común |
| **CLI `claude`** | proveedor `claude-code` | sólo el interruptor `ORQ_CLAUDE_CODE` | el proveedor aparece y sus turnos fallan |
| **CLI `opencode`** | proveedor `opencode` | `ORQ_OPENCODE` + `OPENCODE_COMMAND` | ídem; el health check lo dice |
| **CLI `ant`** | token de `claude-sesion` | lo corrés vos | sin token, 401 |
| **n8n** | correo (`send_email`), MCP `n8n-mcp` | `N8N_EMAIL_WEBHOOK_URL` | `send_email` falla diciendo qué falta |
| **Obsidian** (opcional) | ver y corregir vaults | no se detecta | nada deja de funcionar |

> [!warning] Cuándo se detecta importa
> Chrome y las claves de imágenes se evalúan **al crear el runtime de cada
> empresa** (`createSkillTools`), adb al construir el `Runtime` y scrcpy la primera
> vez que se abre un espejo. Si instalás algo de eso con el servidor andando,
> **reiniciá el servidor**. Kokoro, `sandbox-exec`, Java y ffmpeg se buscan en cada
> uso.

## git

Lo usa `apps/server/src/git.ts` para todo (clonar, worktrees, instantáneas,
checkpoints, grep), siempre endurecido y con `--git-dir` explícito. También lo
necesitan los tests del servidor. Instalación: el de Xcode Command Line Tools o
`brew install git`. Ver [[Git endurecido]].

## ffmpeg y ffprobe

Qué se usa, por motor:

| Pieza de ffmpeg | Quién | Para qué |
|---|---|---|
| filtro `ass` (**libass**) | `skills/video.ts` | tipografía, íconos y visuales del motor ASS |
| fuente `gradients` | `video.ts`, `estudio.ts` | el fondo que se mueve |
| `zoompan` | `video.ts` | el acercamiento lento de las fotos |
| `drawtext` (**freetype**) | `skills/clips.ts` | rótulos de los clips; necesita una fuente del sistema (Arial Bold, Arial, DejaVu Sans Bold o Liberation Sans Bold); sin fuente, sin rótulo |
| `loudnorm`, `sidechaincompress`, `amix` | `skills/sonido.ts` | cama a −26 LUFS y ducking bajo la voz |
| `libx264`, `aac`, `yuv420p` | los tres motores | el `.mp4` final |
| `libmp3lame` | `scripts/generar-cama.ts` | las camas `.mp3` |
| decodificador `h264` → `mjpeg` | `apps/server/src/dispositivos.ts` | espejo de respaldo sin scrcpy |
| `ffprobe` | `medios.ts`, `narracion.ts` | medir duraciones, pistas y resolución |

Cómo verificar: `ffmpeg -hide_banner -filters | grep -wE "ass|drawtext|gradients"`
y `ffmpeg -hide_banner -encoders | grep -wE "libx264|libmp3lame"`.

> [!danger] No todo ffmpeg sirve
> El `ffmpeg` actual de Homebrew viene recortado: en esta máquina, el 9.0.2 de
> `/opt/homebrew/bin` **no trae `ass`, `drawtext` ni `libmp3lame`**; `ffmpeg@7`
> sí (enlaza libass, freetype, fontconfig, lame y x264). Hace falta un build con
> libass primero en el PATH del servidor. Y un `brew upgrade` puede dejar roto el
> que funcionaba: `dyld: Library not loaded … libx265.NNN.dylib` se arregla
> reinstalando esa fórmula.

## Chrome (por CDP)

`packages/tools/src/skills/chrome.ts` → `buscarChrome` prueba, en orden: la ruta
explícita, `ORQ_CHROME`, Google Chrome, Chromium y Microsoft Edge en
`/Applications`, y `google-chrome`, `google-chrome-stable`, `chromium`,
`chromium-browser` en `/usr/bin`. Se maneja por CDP con el `WebSocket` nativo de
Node: cero dependencias. Cortes: arranque 20 s, comando 30 s, carga 20 s. Lienzo
1920×1080 a 30 fps. Ver [[Navegador Chrome por CDP]].

Los seeds también arman su catálogo con `createSkillTools`: **un seed corrido sin
Chrome deja a sus roles sin las herramientas del motor estudio o de clips**, en
silencio.

## Kokoro y `say`

`skills/narracion.ts` → `buscarKokoro` acepta una carpeta si tiene los tres:
`kokoro-v1.0.onnx`, `voices-v1.0.bin` y `venv/bin/python`. Busca en: opción
explícita, `ORQ_KOKORO_HOME`, `~/.cache/orq-kokoro`, `~/.cache/inspia-kokoro`.

Para instalarlo: crear la carpeta, un `venv` de Python con `kokoro-onnx` y
`soundfile` (traen `onnxruntime` y el fonemizador), y bajar los dos archivos del
modelo v1.0 (≈325 MB y ≈28 MB). `brew install espeak-ng` es opcional: si su
biblioteca está en `/opt/homebrew/lib` o `/usr/local/lib`, el script la usa.
Todo el guion se sintetiza en **un solo proceso** de Python (cargar el modelo
cuesta segundos). Voces `em_alex`, `ef_dora`, `em_santa`, idioma `es-419`.

Sin Kokoro, `say` de macOS con las voces Paulina, Mónica y "Eddy (Español
(México))" a 180 palabras por minuto. En una máquina sin ninguno de los dos no hay
voz. Ver [[Música y narración]] y [[Voz y marca de la empresa]].

## adb, scrcpy, JDK y SDK de Android

- **adb** (`dispositivos.ts` → `detectarAdb`): `$ANDROID_HOME/platform-tools/adb`,
  `$ANDROID_SDK_ROOT/…`, `~/Library/Android/sdk/platform-tools/adb`,
  `~/Android/Sdk/platform-tools/adb` y, al final, el PATH. Instalación: Android
  Studio (SDK en su lugar de siempre). Sin adb, `Dispositivos.disponible` es
  falso: no se registran las herramientas del teléfono y "Vincular" dice "No se
  encontró adb".
- **El SDK se deduce subiendo dos carpetas desde adb.** Un adb del PATH que no
  esté dentro de un SDK (por ejemplo el de un paquete suelto de platform-tools)
  deja la build y el AAB sin SDK: definí `ANDROID_HOME`.
- **build-tools** (`aab.ts` → `buildTools`): la versión más nueva que traiga
  `aapt2` **y** `apksigner`. Obligatorias para un APK; un AAB se verifica con
  `unzip` y `keytool`. Se instalan desde el SDK Manager.
- **JDK 17** (`detectarJava`): `JAVA_HOME` si existe, `/usr/libexec/java_home -v
  17`, o el `jbr` de Android Studio. `brew install openjdk@17` sirve. `keytool`
  sale de ese JDK y se llama con `-J-Duser.language=en` (en castellano contesta
  "Propietario").
- **scrcpy** (`scrcpy.ts` → `detectarScrcpy`): `SCRCPY_SERVER_PATH` o
  `share/scrcpy/scrcpy-server` en `/opt/homebrew`, `/usr/local` o `/usr`; la
  versión se lee de `scrcpy --version` junto al servidor (o `SCRCPY_VERSION`).
  `brew install scrcpy`. El protocolo es interno y cambia entre versiones; lo
  medido está en 4.1.
- **sqlite3** de la máquina: `consultar_base_de_la_app` usa `-readonly -safe
  -box`, que pide 3.37+. Ojo: `platform-tools` trae su propio `sqlite3` y suele
  quedar primero en el PATH.

Ver [[App móvil en el teléfono]] y [[Build de producción Android]].

## `sandbox-exec` y `cp -c`

`hayAislamiento()` es verdadero en macOS con `/usr/bin/sandbox-exec` (viene con
el sistema). Sin él, `ejecutar_comando`, la terminal del IDE y los servicios de
vista previa se niegan hasta que una persona prende `sinAislamiento` en el repo.
`copiarModulos` usa `cp -cR` (clon copy-on-write de APFS) y cae a `cp -R` si el
volumen no lo soporta. Ver [[Comandos y sandbox]] y [[Servicios del monorepo]].

## Los CLIs de los proveedores

- **`claude`** (Claude Code): el adaptador invoca `claude` del PATH; se loguea
  con la suscripción (`claude auth login`). CLAUDE.md lo da por verificado contra
  la versión 2.1.282. Ver [[Proveedor claude-code]].
- **`opencode`**: `OPENCODE_COMMAND` si no se llama así; `opencode auth login` y
  `opencode models`. Ver [[Proveedor opencode]].
- **`ant`**: `ant auth login` y `export ANTHROPIC_AUTH_TOKEN=$(ant auth
  print-credentials --access-token)` para `claude-sesion`. Ver
  [[Proveedor Anthropic y claude-sesion]].

## Servicios externos opcionales

- **n8n**: el webhook de `N8N_EMAIL_WEBHOOK_URL` despacha el correo (corte 15 s);
  el MCP `n8n-mcp` (`npx -y n8n-mcp`) trabaja sin credenciales o, con
  `N8N_API_URL`/`N8N_API_KEY` por referencia, despliega y lee ejecuciones. Ver
  [[Correo y avisos]] y [[ADR-007 Correo por webhook de n8n]].
- **Servidores MCP por `npx`**: los del seed (`@modelcontextprotocol/server-*`),
  Playwright, Browser MCP (necesita su extensión en Chrome). Necesitan red la
  primera vez.
- **Obsidian**: para abrir los vaults de empresa (`CONTEXTO_DIR`) y esta bóveda.
  El vault se escribe por filesystem: el contexto **no depende** de que Obsidian
  esté abierto. El seed de INSPIA — Publicidad además usa el plugin Local REST
  API (puerto HTTP 27123, token en `OBSIDIAN_BEARER`).

## Verificación rápida

```bash
node -v                                            # 22.9 o más
git --version
ffmpeg -hide_banner -filters | grep -wE "ass|drawtext|gradients"
ls "/Applications/Google Chrome.app"
ls ~/.cache/orq-kokoro 2>/dev/null || echo "sin Kokoro: voz de say"
which adb scrcpy claude opencode
/usr/libexec/java_home -v 17
ls ~/Library/Android/sdk/build-tools
test -x /usr/bin/sandbox-exec && echo "con sandbox"
```

## Fuentes

- `packages/tools/src/skills/index.ts` → `createSkillTools`
- `packages/tools/src/skills/chrome.ts` → `buscarChrome`, `CANDIDATOS`, `CORTE`
- `packages/tools/src/skills/narracion.ts` → `buscarKokoro`, `VOCES`, `PYTHON_KOKORO`
- `packages/tools/src/skills/video.ts`, `estudio.ts`, `clips.ts` → `FUENTES_DE_ROTULO`, `sonido.ts`, `medios.ts`
- `packages/tools/src/skills/imagenes.ts` → `crearGeneradorImagenes`
- `apps/server/src/dispositivos.ts` → `detectarAdb`, `detectarJava`, `Dispositivos.disponible`
- `apps/server/src/scrcpy.ts` → `detectarScrcpy`; `apps/server/src/aab.ts` → `buildTools`
- `apps/server/src/depuracion-movil.ts` (sqlite3); `apps/server/src/servicios.ts` → `copiarModulos`
- `packages/tools/src/codigo/ejecutar.ts` → `hayAislamiento`
- `apps/server/src/runtime.ts` → `registrarCodigoEn`

## Ver también

- [[Instalación y arranque]] · [[Variables de entorno]] · [[Diagnóstico de problemas]]
- [[Producción audiovisual]] · [[Trabajo con código]] · [[App móvil en el teléfono]]
