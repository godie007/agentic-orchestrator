---
tags: [operación, referencia]
aliases: [.env, .env.example, Configuración, Env, loadEnv, ProviderEnv, buildRegistry, entornoDeComando]
---

# Variables de entorno

Todas las variables que lee el código, quién las lee, su valor por defecto y qué
cambian. Nombres sí, valores nunca: `.env` está en `.gitignore` y esta bóveda está
versionada.

## Cómo se cargan

- **`.env` en la raíz del monorepo**, plantilla en `.env.example`. Lo carga `tsx
  --env-file-if-exists=.env` en los scripts del servidor (`dev`, `start`,
  `db:seed`, `db:migrate`) y en `db:estudio`, `db:inspia*`, `db:observatorio`,
  `musica:cama`, `check:llm`, `check:models`.
- **No lo cargan**: `npm run auditar`, `npx tsx scripts/vault-contexto.ts` y
  `npx vitest`. Esos leen sólo el entorno del shell (o sus defaults).
- **Se leen una vez.** `loadEnv` (`apps/server/src/env.ts`) valida al arrancar:
  los numéricos tienen que ser **positivos**, o el servidor no arranca
  (`PORT="…" no es un número positivo válido.`). Varias constantes de los
  adaptadores se leen **al importar el módulo** (`CLAUDE_CODE_SILENCIO_MS`,
  `CLAUDE_CODE_CODIGO_TIMEOUT_MS`, `OPENCODE_TIMEOUT_MS`,
  `ORQ_ESPERA_PROVEEDOR_MS`). Cualquier cambio pide **reiniciar el servidor**.
- **Rutas ancladas.** Las de `loadEnv` pasan por `fromRoot`: una relativa se
  resuelve contra la raíz del repo, no contra el cwd. **Excepción:**
  `CLAUDE_CODE_WORKDIR` y `OPENCODE_WORKDIR` llegan crudas al adaptador y se
  resuelven contra el cwd del proceso (`apps/server/` con `npm run dev`).
- **Interruptores.** `ORQ_CLAUDE_SESION`, `ORQ_CLAUDE_CODE`, `ORQ_OPENCODE` y
  `ORQ_OPENCODE_COSTO` se prenden con `1`, `true`, `si` o `sí`
  (`registry.ts` → `esVerdadero`). Cualquier otra cosa, apagado.

## Servidor (`apps/server/src/env.ts` → `loadEnv`)

| Variable | Default | Qué cambia |
|---|---|---|
| `PORT` | `3001` | puerto de Fastify (escucha en `127.0.0.1`). Vite lo lee del mismo `.env` para el proxy |
| `DATABASE_URL` | `./data/orquestador.db` | archivo SQLite. Los tokens OAuth de MCP van en `mcp-oauth/` **junto a este archivo** |
| `PROYECTOS_DIR` | `./data/proyectos` | carpeta legible por proyecto: salida, repos, worktrees, tmp. Ver [[Directorios en disco]] |
| `EXPORTS_DIR` | `./data/exports` | layout viejo de la salida; sólo se lee al arrancar para mudarlo |
| `MUSICA_DIR` | `./data/musica` | biblioteca de camas musicales; si no existe, los videos salen sin música |
| `CONTEXTO_DIR` | `./data/contexto` | vault de Obsidian por empresa. Ver [[Vault de contexto]] |
| `DEFAULT_RUN_BUDGET_USD` | `1` | tope de gasto por corrida cuando no se pide otro. Ver [[Costos y presupuesto]] |
| `DEFAULT_MAX_TICKS` | `50` | ciclos máximos por corrida |
| `AGENT_CONCURRENCY` | `4` | turnos en paralelo dentro de un ciclo |
| `N8N_EMAIL_WEBHOOK_URL` | — | webhook que despacha el correo. Sin él `send_email` falla diciendo qué falta. Ver [[Correo y avisos]] |
| `APP_URL` | `http://localhost:5173` | origen permitido por CORS y el WebSocket, enlaces a la UI en los avisos, `HTTP-Referer` en OpenRouter. **Tiene que ser una URL válida** o el servidor no arranca |
| `API_URL` | `http://localhost:<PORT>` | base de los enlaces de descarga en los correos y de la vuelta OAuth (`<API_URL>/api/mcp/oauth/callback`) |
| `MISION_TICK_MS` | `30000` | cada cuánto el planificador mira qué misión venció. Ver [[Misiones programadas]] |

## Proveedores LLM (`packages/llm/src/registry.ts` → `buildRegistry`)

Un proveedor sin credencial **no se registra**: no falla el arranque, sólo no
aparece. Detalle de cada uno en las notas de `Proveedores LLM`.

| Variable | Default | Registra / cambia |
|---|---|---|
| `OPENROUTER_API_KEY` | — | `openrouter`. Ver [[Proveedor OpenRouter]] |
| `APP_URL`, `APP_TITLE` | — | cabeceras `HTTP-Referer` y `X-Title` de OpenRouter (atribución pública, sin efecto funcional) |
| `ANTHROPIC_API_KEY` | — | `anthropic` |
| `ORQ_CLAUDE_SESION` | apagado | `claude-sesion`: el mismo adaptador con el token de `ant auth login` |
| `ANTHROPIC_AUTH_TOKEN` | — | el token de `claude-sesion` (`ant auth print-credentials --access-token`); **de corta vida**, se vuelve a exportar cuando vence |
| `ORQ_CLAUDE_CODE` | apagado | `claude-code`: delega el turno al CLI `claude` con la suscripción |
| `CLAUDE_CODE_MODEL` | `sonnet` | alias por defecto del CLI (`haiku`/`sonnet`/`opus`) |
| `CLAUDE_CODE_WORKDIR` | `<tmpdir>/orq-claude-code` (`.env.example` trae `./data/claude-code`) | carpetas `turno-*` de los turnos libres y `transcripciones/` (últimas 300) |
| `ORQ_OPENCODE` | apagado | `opencode`: delega al CLI `opencode` |
| `OPENCODE_MODEL` | `opencode/claude-sonnet-5` (`.env.example` trae un `-free`) | modelo por defecto, formato `proveedor/modelo` |
| `OPENCODE_WORKDIR` | `<tmpdir>/orq-opencode` | carpeta de trabajo de los turnos |
| `OPENCODE_COMMAND` | `opencode` | binario, si no está en el PATH |
| `ORQ_OPENCODE_COSTO` | apagado | reportar al ledger el costo que informa el CLI (prenderlo sólo con créditos por uso) |
| `OPENAI_API_KEY` | — | `openai` (y generador de imágenes, 2º) |
| `NVIDIA_API_KEY` | — | `nvidia` (y generador de imágenes, 3º) |
| `OLLAMA_BASE_URL` | — | `ollama`. **`.env.example` lo trae con valor**: copiarlo registra Ollama aunque no esté corriendo. Vacío lo desactiva |

> [!danger] Una `ANTHROPIC_API_KEY` vacía pisa la sesión
> El SDK toma la variable aunque esté vacía y autentica en blanco: 401 sin
> explicación. `.env.example` la trae vacía. Al prender `ORQ_CLAUDE_SESION`,
> `buildRegistry` la **borra de `process.env`** si está vacía; una con valor la
> respeta (fijado en `packages/llm/src/registry.test.ts`).

> [!note] Lo que el CLI de Claude Code no recibe
> `entornoDelCli` (`packages/llm/src/adapters/claude-code.ts`) le saca
> `ANTHROPIC_API_KEY` y `ANTHROPIC_AUTH_TOKEN`: con una clave en el entorno, `claude
> -p` factura por API en vez de por la suscripción, y ese costo se reporta en 0.
> El resto del entorno pasa tal cual; el modelo siempre va explícito con
> `--model`. El CLI de **opencode**, en cambio, recibe `process.env` entero más su
> `OPENCODE_CONFIG`.

## Cortes, reintentos y esperas

| Variable | Default | Quién la lee | Qué cambia |
|---|---|---|---|
| `CLAUDE_CODE_SILENCIO_MS` | `180000` | `claude-code.ts` → `SILENCIO_MAX_MS` | silencio del CLI tolerado antes de darlo por colgado (no cuenta mientras corre una herramienta del org) |
| `CLAUDE_CODE_CODIGO_TIMEOUT_MS` | `1500000` (25 min) | `claude-code.ts` → `CORTE_CODIGO_MS` | corte de un turno que programa; el común es fijo en 10 min (`CORTE_MS`) |
| `CLAUDE_CODE_MAX_RETRIES` | `4` si no está definida | `entornoDelCli` | reintentos internos del CLI (el CLI trae 10) |
| `ENABLE_TOOL_SEARCH` | `false` si no está definida | `entornoDelCli` | apaga la carga diferida de herramientas: 58 `ToolSearch` medidos en una corrida |
| `OPENCODE_TIMEOUT_MS` | `1200000` (20 min) | `opencode.ts` → `CORTE_MS` | corte de un turno de opencode; uno de código usa ×1,5 |
| `ORQ_ESPERA_PROVEEDOR_MS` | `30000` | `packages/engine/src/scheduler.ts` → `ESPERA_BASE_MS` | espera tras un ciclo entero fallido: 30 s, 60 s, 120 s (tope `max(base, 120000)`). Los tests la ponen en `0` |

## Habilidades y dependencias del sistema

| Variable | Quién la lee | Qué cambia |
|---|---|---|
| `GOOGLE_API_KEY` (o `GEMINI_API_KEY`) | `packages/tools/src/skills/imagenes.ts` → `crearGeneradorImagenes` | generador de imágenes Gemini, **primero** |
| `OPENAI_API_KEY` | ídem | `gpt-image-1`, segundo |
| `NVIDIA_API_KEY` | ídem | FLUX schnell, tercero. Sin ninguna de las tres, `generar_imagen` **no se registra** |
| `ORQ_KOKORO_HOME` | `skills/narracion.ts` → `buscarKokoro` | dónde está Kokoro (antes que `~/.cache/orq-kokoro` y `~/.cache/inspia-kokoro`) |
| `ORQ_CHROME` | `skills/chrome.ts` → `buscarChrome` | ruta explícita del navegador (antes de las ubicaciones conocidas) |
| `ANDROID_HOME`, `ANDROID_SDK_ROOT` | `apps/server/src/dispositivos.ts` → `detectarAdb` | dónde buscar `platform-tools/adb`; el SDK se deduce subiendo dos carpetas desde adb |
| `JAVA_HOME` | `dispositivos.ts` → `detectarJava` | JDK para Gradle (build de desarrollo, AAB); si no, `java_home -v 17` o el de Android Studio |
| `SCRCPY_SERVER_PATH`, `SCRCPY_VERSION` | `apps/server/src/scrcpy.ts` → `detectarScrcpy` | servidor de scrcpy fuera de Homebrew y su versión (el protocolo cambia entre versiones) |
| `PATH`, `HOME`, `SSH_AUTH_SOCK` | `apps/server/src/git.ts` → `entornoGit` | lo único del entorno que ve git (más su agente SSH) |

Qué pasa si falta cada programa: [[Dependencias del sistema]].

## Scripts

| Variable | Script | Default | Qué cambia |
|---|---|---|---|
| `ORQ_SEED_TIER` | `db:estudio` | `free` | tier de los seis roles del estudio |
| `ORQ_SEED_PROVEEDOR` | `db:estudio` | `claude-code` si `ORQ_CLAUDE_CODE` está prendido, si no `openrouter` | proveedor de los roles |
| `ORQ_SEED_MODELO` | `db:estudio` | `claude-code/sonnet` con claude-code, si no `null` | slug fijo |
| `ORQ_API` | `db:observatorio` | `http://localhost:3001` | servidor al que le pide el catálogo MCP para asignar herramientas |

## Referenciadas por servidores MCP (por nombre)

La configuración guarda **el nombre** y `resolveSecret` busca el valor en
`process.env` al conectar. Tienen que estar en el `.env` (o exportadas antes de
arrancar el servidor). Ver [[Integración MCP]] y [[Referencia de la tienda MCP]].

| Origen | Variables |
|---|---|
| `.env.example` (n8n-mcp) | `N8N_API_URL`, `N8N_API_KEY` |
| Tienda (`packages/shared/src/tienda-mcp.ts` → `envRequeridas`) | `GITHUB_PERSONAL_ACCESS_TOKEN`, `GITLAB_PERSONAL_ACCESS_TOKEN`, `SUPABASE_ACCESS_TOKEN`, `BRAVE_API_KEY`, `TAVILY_API_KEY`, `FIRECRAWL_API_KEY`, `EXA_API_KEY`, `AIRTABLE_API_KEY`, `STRIPE_SECRET_KEY`, `SLACK_BOT_TOKEN`, `SLACK_TEAM_ID`, `NOTION_TOKEN`, `GOOGLE_MAPS_API_KEY` |
| Seed `db:inspia-publicidad` | `OBSIDIAN_BEARER` (token del plugin Local REST API, con el prefijo `Bearer`) |

`GET /api/tienda-mcp` marca como `envFaltantes` las obligatorias que no están en
`process.env`, y la salud de cada servidor lista las referencias sin valor.

## Leídas del `.env` de un servicio del proyecto, no del orquestador

Viven en la carpeta de la persona (el backend de INSPIA, su app móvil) y se leen
en el momento; nunca pasan por el `.env` del orquestador ni por la base.

| Variables | Para qué | Dónde |
|---|---|---|
| `R2_ENDPOINT` o `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_REGION` (default `auto`) | verificar subidas en Cloudflare R2 | `apps/server/src/r2.ts` → `credencialesR2`. Ver [[Almacenamiento R2]] |
| `*_ENV` / `*ENVIRONMENT` = `prod`/`production` y los `marcadoresProduccion` | decidir que una app apunta a producción | `apps/server/src/qa-movil.ts` → `detectarProduccion` |
| `EXPO_PUBLIC_*` de `.env.prod` | verificar que el AAB apunte a producción | `apps/server/src/aab.ts` |
| `SENTRY_AUTH_TOKEN` de `.env.prod` | sin él se agrega `SENTRY_DISABLE_AUTO_UPLOAD=true` al build | `aab.ts` |
| la `variablePuerto` del servicio (típicamente `PORT`) | el puerto asignado a la vista previa | `apps/server/src/servicios.ts` |

## Inyectadas por el orquestador a sus procesos hijos

No se configuran: se listan para que un comportamiento raro de un proceso hijo
tenga explicación.

| A quién | Variables | Por qué |
|---|---|---|
| `ejecutar_comando`, terminal del IDE, instalaciones (`entornoDeComando`) | `CI=1`, `NO_COLOR=1`, `FORCE_COLOR=0`, `TERM=dumb`, `TMPDIR`/`TMP`/`TEMP` al tmp del proyecto, `npm_config_yes/update_notifier/fund/audit`; **sin** nada que matchee `KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|SESSION` ni que empiece con `ORQ_`, `ANTHROPIC`, `OPENAI`, `OPENROUTER`, `NVIDIA`, `GEMINI`, `GOOGLE_`, `AWS_`, `AZURE_`, `N8N_`, `DATABASE_URL`, `CLAUDE_CODE` | sin `CI=1` vitest/jest arrancan en watch y no terminan; un test no tiene por qué ver credenciales |
| vista previa de servicios (`entornoDeServicio`) | lo mismo **sin** `CI`, más `BROWSER=none`, `EXPO_NO_TELEMETRY=1`, `EXPO_NO_REDIRECT_PAGE=1` y el `.env` propio del servicio | Expo apaga la recarga con `CI`; `expo start --web` abre pestañas solo |
| git (`entornoGit`) | `LANG=C`, `LC_ALL=C`, `GIT_TERMINAL_PROMPT=0`, `GIT_SSH_COMMAND` en batch, `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_OPTIONAL_LOCKS=0`, a veces `GIT_INDEX_FILE` | ver [[Git endurecido]] |
| CLI `claude` (`entornoDelCli`) | `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` más las dos de la tabla de cortes | |
| relay del puente MCP del org | `ORQ_SOCKET` (socket Unix en el tmpdir, por turno) | ver [[Turnos delegados a un CLI]] |
| CLI `opencode` | `OPENCODE_CONFIG` (config del turno, fusionada con la del usuario) | |
| build de desarrollo y AAB | `JAVA_HOME`, `ANDROID_HOME`, `ANDROID_SDK_ROOT`, `ANDROID_SERIAL`, `NODE_ENV` | ver [[Build de producción Android]] |
| Python de Kokoro | `PHONEMIZER_ESPEAK_LIBRARY`, `ESPEAK_DATA_PATH` si encuentra espeak-ng de Homebrew | |

## En los tests

`vitest.config.ts` fija `ORQ_ESPERA_PROVEEDOR_MS=0`; los tests de git corren con
`GIT_CONFIG_GLOBAL=/dev/null`; `registry.test.ts` guarda y restaura
`ANTHROPIC_API_KEY`. Ver [[Pruebas y calidad]].

## Lo que NO va en `.env` de un proyecto exportable

Los **valores** de los secretos de MCP no van en la base ni en el blueprint: la
configuración guarda el nombre de la variable. La variable en sí sí vive en el
`.env` del orquestador. Mantené esa regla al agregar campos. Ver [[Seguridad]].

> [!tip] Rotar credenciales
> Si una API key pasó por un chat, un ticket o una captura, rotala: quedó en ese
> historial. La nueva va sólo en `.env`.

## Fuentes

- `apps/server/src/env.ts` → `loadEnv`, `numeric`, `fromRoot`, `resolveSecret`
- `packages/llm/src/registry.ts` → `ProviderEnv`, `buildRegistry`, `esVerdadero`
- `packages/llm/src/adapters/claude-code.ts` → `SILENCIO_MAX_MS`, `CORTE_CODIGO_MS`, `entornoDelCli`
- `packages/llm/src/adapters/opencode.ts` → `CORTE_MS`, `correr`
- `packages/engine/src/scheduler.ts` → `ESPERA_BASE_MS`
- `packages/tools/src/codigo/ejecutar.ts` → `entornoDeComando`, `entornoDeServicio`
- `packages/tools/src/skills/imagenes.ts`, `narracion.ts`, `chrome.ts`
- `apps/server/src/dispositivos.ts`, `scrcpy.ts`, `git.ts`, `r2.ts`, `aab.ts`, `routes.ts` (`/api/tienda-mcp`)
- `scripts/seed-estudio-codytion.ts`, `scripts/seed-observatorio-ia.ts`, `vitest.config.ts`, `.env.example`

## Ver también

- [[Instalación y arranque]] · [[Dependencias del sistema]] · [[Seguridad]]
- [[Capa LLM y tiers]] · [[Costos y presupuesto]] · [[Diagnóstico de problemas]]
