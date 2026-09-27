---
tags: [operación, seguridad]
aliases: [Seguridad, Modelo de amenaza, Secretos, Sandbox, CORS, safePath]
---

# Seguridad

El modelo de seguridad completo, verificado en el código: qué se protege, contra
quién, dónde vive cada freno y qué **no** cubre.

## Alcance y modelo de amenaza

El orquestador corre **local, para una sola persona**, sin autenticación propia:
la API escucha en `127.0.0.1` (`apps/server/src/index.ts`). Las amenazas que sí
se modelan son cuatro:

1. **Un agente LLM hace algo que no debería**: borrar trabajo ajeno, escribir
   fuera de su carpeta, leer credenciales, tocar producción.
2. **Código escrito por un agente corre en la máquina o en el navegador de la
   persona**: los tests que escribe, la app que levanta la vista previa, un
   `.html` que produce.
3. **Una página cualquiera abierta en el navegador le pega a `localhost`**.
4. **Un secreto se filtra** a la base, al blueprint exportado, al prompt o a un
   log que lee un agente.

Un atacante con acceso a la máquina queda fuera de alcance: cualquier proceso
local puede llamar a la API.

## Superficie de red

- **API en `127.0.0.1`**, nunca en `0.0.0.0`. Lo mismo el proxy de la vista
  previa (`proxy-vista.ts`) y el servidor de salud de servicios.
- **CORS cerrado a la app** (`construirApp({ origenes })`): el origen de
  `APP_URL`, `localhost:5173`, `127.0.0.1:5173` y el propio servidor. Un pedido
  sin `Origin` (curl, los tests) pasa. Antes era `origin: true` y, con vista
  previa, eso incluía el JavaScript de un agente; la UI va por el proxy de Vite y
  no lo nota.
- **WebSocket del espejo con `Origin` verificado** (`ws.ts` →
  `aceptarWebSocket`): un WebSocket no pasa por CORS; sin esto cualquier página
  podría manejar el teléfono. Un origen ajeno recibe `403`; sin `Origin` (un
  cliente que no es navegador) se acepta.
- **`adb reverse`** tiende túneles del teléfono a la máquina: nada se expone a la
  red local.
- **`fetch_url` bloquea hosts internos** (`capability.ts` → `isPrivateHost`):
  `localhost`, `*.localhost`, `*.internal`, `::1`, `127/8`, `10/8`, `0/8`,
  `172.16/12`, `192.168/16`, `169.254/16` (metadatos de nube). Corte de 20 s.
- **Toda llamada saliente lleva corte por tiempo**: un endpoint que acepta y se
  calla cuelga el turno sin que el agente pueda cambiar de enfoque (lo medimos con
  el endpoint de imágenes de NVIDIA). Imágenes 90 s, correo 15 s, R2 20 s, git
  60 s, Chrome 20–30 s, adb 20 s.
- **`caPath` verifica, no saltea**: un MCP HTTP con CA propia se valida contra
  ella; en ningún caso se apaga la verificación TLS.
- **Los adjuntos de correo viajan como enlace** a `API_URL`, no como bytes. Ver
  [[Correo y avisos]].

## Secretos

### Por referencia, nunca por valor

Los servidores MCP guardan **el nombre** de la variable (`envRefs` en stdio,
`headerRefs` en HTTP) y `resolveSecret` (`env.ts`) lee `process.env` al conectar.
Así un blueprint exportado a JSON no lleva credenciales. La regla se aplica en
todas las puertas:

- **Pegar JSON en el Hub** (`parsearConfigMcp`, `packages/shared/src/mcp-config.ts`):
  un valor que parece nombre (`GITHUB_TOKEN`, `${GITHUB_TOKEN}`, `$X`) entra como
  referencia; uno que parece secreto **se descarta con un aviso**. Ante la duda
  gana no guardar.
- **Un agente que pide un servidor** (`solicitar_servidor_mcp`): se sanea en la
  herramienta, así lo que llega a la bandeja ya no puede llevar un secreto.
- **La tienda** declara `envRequeridas` por nombre; un test verifica que ningún
  transporte del catálogo tenga un valor con pinta de secreto.
- **URLs de git** con `usuario:token@` se rechazan (`validarUrlGit`): la URL se
  guarda y viaja en el blueprint.

Un MCP stdio recibe sólo `HOME`, `LOGNAME`, `PATH`, `SHELL`, `TERM`, `USER` (lo que
hereda por defecto el SDK de MCP) más sus referencias resueltas, no el entorno
entero del servidor.

### Donde vive cada credencial

| Credencial | Dónde vive | Qué la protege |
|---|---|---|
| API keys de proveedores | `.env` del orquestador | `.gitignore`; nunca en la base |
| tokens OAuth de MCP remotos | `dirname(DATABASE_URL)/mcp-oauth/<id>.json` | archivo `0600`, carpeta `0700`, se borra con el servidor (`olvidarOAuth`); nunca en la base |
| `.env` de los servicios de un proyecto | carpeta de la persona | se leen al arrancar y se **inyectan**; no se copian al worktree ni a la base; el blueprint vacía `archivosEntorno`; sólo se aceptan archivos llamados `.env*` |
| `.env.prod` del build Android | carpeta de la persona | entra sólo al proceso del build; el log muestra **nombres**, nunca valores; no pasa por `redirigirUrlsLocales` |
| credenciales R2 de un servicio | su `.env` | se leen en el momento; el agente nombra una clave y recibe metadatos, **nunca la llave** |
| firma de release Android | `~/.gradle/gradle.properties` de la persona | el orquestador no la toca; sólo verifica el resultado |
| sesión de `claude`/`opencode` | el login de cada CLI | el orquestador no la ve |

### Qué no llega a quién

- **Comandos de agentes y terminal del IDE** (`entornoDeComando`): se quitan las
  variables cuyo nombre matchea `KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|SESSION`
  o empieza con `ORQ_`, `ANTHROPIC`, `OPENAI`, `OPENROUTER`, `NVIDIA`, `GEMINI`,
  `GOOGLE_`, `AWS_`, `AZURE_`, `N8N_`, `DATABASE_URL`, `CLAUDE_CODE`.
- **CLI de Claude Code** (`entornoDelCli`): sin `ANTHROPIC_API_KEY` ni
  `ANTHROPIC_AUTH_TOKEN`.
- **Logs de la vista previa y respuestas de `probar_servicio`**: los valores de
  variables secretas (`esClaveSecreta`, de 8 caracteres o más) se reemplazan por
  `«secreto»`.
- **Logs del teléfono** (`taparSecretos`): JWT, `Bearer …`, `sb_secret_…` y
  `apikey=`/`token=` en URLs.
- **Inspector de la vista previa**: nunca manda cabeceras (ahí va el token), sólo
  el cuerpo de las respuestas que fallan y la descripción de un multipart.

## Código que escriben los agentes

La allowlist decide **qué** corre; el sandbox **contiene** lo que corre. Detalle
en [[Comandos y sandbox]].

- **Sin shell** (`@orq/shared/argv.ts` → `tokenizar`): argv tal cual; `;`, `|`,
  `$(`, backticks, `*` y `?` se rechazan.
- **Allowlist por token** (`empiezaCon`): `npm test` no habilita `npm testx`.
  `validarPrefijoPermitido` no acepta como entrada shells, `env`, `sudo`, `curl`,
  `ssh`, `rm`…, ni `node`/`python`/`npx` a secas, ni `npm run` sin script, ni
  `npm publish/login/config`. `git push/remote/config/credential/submodule/
  filter-branch/gc/worktree` nunca; la lectura de git (`status`, `diff`, `log`…)
  siempre, salvo flags que escriben o ejecutan (`--output`, `--ext-diff`,
  `--textconv`, `--git-dir`…).
- **`sandbox-exec`** (`ejecutar.ts` → `perfilSandbox`): escritura denegada salvo
  en el worktree, el tmp del proyecto, los cachés de paquetes, `/private/tmp` y el
  tmp del usuario; **nunca** en el `.git` del clon ni en el archivo `.git` del
  worktree (un hook ahí corre fuera del sandbox en el próximo checkpoint); lectura
  negada de `~/.ssh`, `~/.aws`, `~/.config/gh`, `~/.gnupg`, `~/.docker`, `~/.kube`,
  `~/.config/gcloud`, `~/.azure`, `.netrc`, `.npmrc`, `.pypirc`,
  `.git-credentials`. Sin `sandbox-exec`, el repo necesita el opt-in
  `sinAislamiento` de una persona. Las vistas previas corren en el mismo sandbox.
- **Corte**: se mata el **grupo** de procesos (nietos incluidos).
- **Dependencias** (`@orq/shared/dependencias.ts`): sólo paquetes del registro por
  nombre (nada de URLs, `git:`, `file:` ni rutas) y siempre `--ignore-scripts`;
  se valida al pedir y **otra vez al aprobar**. Ver [[Instalación de dependencias]].
- **Git endurecido** (`apps/server/src/git.ts`): `core.hooksPath=/dev/null`,
  `core.fsmonitor=false`, sin firma, identidad fija, `protocol.ext.allow=never`,
  sin config global ni de sistema, `GIT_TERMINAL_PROMPT=0`, SSH en batch,
  `--git-dir` explícito y corte de 60 s. Ver [[Git endurecido]].
- **Rutas de código** (`resolverEnWorktree`): relativas, sin salir del árbol, sin
  `.git`, resueltas con `realpath` (un symlink no saca afuera).
- **Uno escribe por vez**: el arriendo de escritura. Ver
  [[Arriendo de escritura y resumen de código]].
- **Los agentes no commitean ni publican**: integrar y `git push` los hace una
  persona desde el panel. Ver [[Control de versiones y publicación]].

## Los CLIs que delegan

- **Claude Code** (`claude-code.ts`): sobre la salida de la empresa sólo `Read`,
  `Glob`, `Grep`, `WebSearch`, `WebFetch`; en un repo, `Edit/Write` sólo con el
  arriendo; **nadie recibe `Bash`**, que además se niega explícito junto con
  `Edit(.git/**)`/`Write(.git/**)`. `--strict-mcp-config`: sólo entra el puente
  del org, no los MCP globales de la persona. El modo con `Bash` ("libre") sólo lo
  usa el health check, en una carpeta propia por turno.
- **opencode** (`opencode.ts` → `configDelTurno`): `"*": false` y se habilita sólo
  lo suyo; sobre la salida `edit` y `bash` en `deny` (con `--auto`, lo que no se
  niega se aprueba); `--pure` sin plugins.

Ver [[Turnos delegados a un CLI]].

## Archivos de la empresa

- **`ExportStore.safePath`** sanea cada segmento de una ruta propuesta por un
  modelo (descarta `.`, `..`, vacíos; profundidad máxima 6) y la resolución final
  se verifica contra la ruta real.
- **Borrar tiene dos reglas**: `removeComoAgente` sólo acepta multimedia o lo que
  la empresa generó (manifiesto `.orq-generado.json`; sin manifiesto, todo es
  externo: falla seguro), y `puedeBorrar` mira la autoridad (`executive` todo,
  `manager` apoyo pero no `.docx`/`.pdf`, `executor` nada). En lote se filtra
  **antes** de borrar. El borrado desde la UI no pasa por ninguna: decide una
  persona.
- **Producir queda abierto** para los tres niveles.
- **Publicar** (`ExportStore.publicar` → `publicado/`) no tiene herramienta de
  agente. Los AAB/APK de `salida/builds/android/` no se marcan como generados: un
  agente no los puede borrar.

Ver [[Archivos de salida y permisos de borrado]] y
[[ADR-008 Publicar lo decide una persona]].

## El navegador de la persona

- **Vista previa de un repo** (`/api/repos/:repoId/vista/*`): la sirve el
  servidor con `Content-Security-Policy: sandbox allow-scripts allow-pointer-lock
  allow-forms` —vale también si se abre en otra pestaña— y **sólo esas
  respuestas** van con `Access-Control-Allow-Origin: *` (con origen opaco los ES
  modules necesitan CORS). El iframe va sin `allow-same-origin`.
- **Vista previa de un servicio**: el iframe apunta a su propio puerto
  (`127.0.0.1:43xx`), otro origen que la API no acepta.
- **Selector e inspector** (`SELECTOR_JS`): duermen hasta que el IDE los activa
  por `postMessage`, después sólo le hablan **al origen que saludó**; el único
  mensaje a `*` es "estoy lista", sin datos.
- **Salida en la UI**: un `.html` de un agente se dibuja en un iframe con
  `sandbox=""` (sin scripts ni origen).
- **Chat del IDE**: el markdown de un agente no ejecuta HTML crudo ni enlaces
  `javascript:`.

## El teléfono de la persona

Todas las herramientas miran **sólo la app del repo**
(`depuracion-movil.ts`, reglas puras con tests): logs filtrados por uid de la
app, archivos por `run-as` con rutas relativas sin `..`, base de datos como
**copia** (con su `-wal`) abierta `-readonly -safe` con una sola sentencia de
lectura, `adb_diagnostico` con allowlist por token atada al paquete (nada de
`dumpsys notification`), captura sólo con la app al frente y la pantalla prendida,
y `limpiar_datos_de_la_app` con **aprobación**. QA móvil (`qa-movil.ts`) toca por
nombre, nunca en las barras del sistema (`ZONA_UTIL`), frena si la app deja de
estar al frente y **se niega si el entorno apunta a producción**
(`detectarProduccion`: marcadores del servicio de 5+ caracteres o `*_ENV=prod`),
nombrando variables, nunca valores. R2 es de sólo lectura y tampoco consulta un
entorno de producción. Ver [[Depuración de la app móvil]], [[QA móvil]] y
[[Almacenamiento R2]].

## Lo que decide una persona

- Herramientas con `requiresApproval` no corren: abren una aprobación y
  **aprobar ejecuta esa misma llamada** con los argumentos que vio la persona. Hoy
  la tiene `limpiar_datos_de_la_app`, y las de MCP que el servidor no declara de
  sólo lectura cuando `autoApproveTools` está apagado.
- Solicitudes: comando (una vez o siempre), dependencia (aprobar instala),
  servidor MCP (aprobar conecta y otorga), acceso a herramientas, rol nuevo.
- Publicar, integrar y subir, la firma y la subida a Play.

Ver [[Aprobaciones y solicitudes]].

## Costo como control

El tope de gasto se evalúa **antes de cada turno**: una llamada cara puede
pasarse. Configurá también un límite en el panel de tu proveedor. Ver
[[Costos y presupuesto]].

## Qué no se versiona

`.gitignore`: `node_modules/`, `dist/`, `dist-types/`, `build/`, `coverage/`,
`.env` y `.env.*` (salvo `.env.example`), `*.db*`, **`data/`** entero (base,
salida, repos, tokens OAuth, vaults de empresa), logs, `.vite/`, `*.tsbuildinfo`,
`.playwright-mcp/`. En los clones gestionados, `.git/info/exclude` deja fuera de
todo commit `.env`, `.env.*`, `*.pem`, `*.key`, `node_modules/`, `dist/`…

Sí se versionan: esta bóveda (incluida `.obsidian/`) y los seeds de `scripts/`.
`seed-inspia-publicidad.ts` siembra una lección con las cuentas del tenant demo de
**staging**, contraseña incluida: tienen que ser credenciales descartables.

## El aviso de `npm audit`

`GHSA-frvp-7c67-39w9` sobre `@hono/node-server`, arrastrado por
`@modelcontextprotocol/sdk`: **no es alcanzable** (el SDK sólo usa hono del lado
servidor; acá se importa sólo el cliente, verificado con grep) y no se aplica un
override porque el arreglo está en 2.x y el SDK pide `^1.x`. Nota completa en
`package.json` → `auditNotes` (última revisión: SDK 1.29.0). No lo "arregles" sin
leerla.

## Límites conocidos

- **Sin autenticación**: cualquier proceso local puede llamar a la API.
- **`/api/companies/:id/exports/*?inline` sirve `.html` y `.svg` sin CSP**: dentro
  del iframe de la UI están aislados, pero abiertos en una pestaña aparte corren
  con el origen de la app.
- **`fetch_url` valida el nombre, no la IP**: sigue redirecciones sin revalidar y
  no resuelve DNS, así que un host público que redirige o resuelve a una IP
  interna pasa. De IPv6 sólo bloquea `::1`.
- **Una carpeta sin git se copia con sus `.env`** (se excluyen del commit, no de
  la copia): los agentes no los ven —trabajan en el worktree—, pero la vista previa
  sin sesión abierta sirve desde esa copia.
- **opencode recibe el entorno entero** del servidor, API keys incluidas, a
  diferencia de Claude Code.
- El build de desarrollo y el AAB corren **fuera del sandbox** (con el entorno
  limpio): los lanza una persona.

## Qué fijan los tests

`mcp-config.test.ts` (secreto literal descartado), `tienda-mcp.test.ts`,
`mcp-oauth.test.ts` (0600), `argv.test.ts`, `dependencias.test.ts`,
`codigo.test.ts` (sin credenciales, sandbox), `claude-code.test.ts` y
`opencode.test.ts` (sólo lectura, sin `Bash`), `exports.test.ts` y
`permisos.test.ts` (borrado), `ide.test.ts` (CORS, vista previa), `ws.test.ts`
(origen), `proxy-vista.test.ts` (sonda), `servicios.test.ts` (secretos tapados),
`depuracion-movil.test.ts`, `qa-movil*.test.ts`, `r2.test.ts`, `repos.test.ts`
(`validarUrlGit`, `.git` intacto), `Markdown.test.tsx`. Ver [[Pruebas y calidad]].

## Fuentes

- `apps/server/src/index.ts`, `app.ts` → `construirApp`, `ws.ts` → `aceptarWebSocket`
- `apps/server/src/env.ts` → `resolveSecret`; `apps/server/src/mcp-oauth.ts`
- `packages/shared/src/mcp-config.ts`, `argv.ts`, `dependencias.ts`, `servicios.ts` → `esClaveSecreta`
- `packages/tools/src/mcp/bridge.ts` → `buildTransport`; `packages/tools/src/capability.ts` → `isPrivateHost`
- `packages/tools/src/codigo/ejecutar.ts`, `codigo/rutas.ts`
- `apps/server/src/git.ts`, `repos.ts` → `EXCLUIDOS`, `copiarSinRegenerables`
- `packages/llm/src/adapters/claude-code.ts`, `opencode.ts`
- `apps/server/src/exports.ts`, `packages/tools/src/skills/permisos.ts`
- `apps/server/src/rutas-codigo.ts` (vista), `routes.ts` (blueprint, exports), `proxy-vista.ts`
- `apps/server/src/servicios.ts`, `aab.ts`, `r2.ts`, `depuracion-movil.ts`, `qa-movil.ts`
- `apps/web/src/routes/Output.tsx`, `routes/codigo/VistaPrevia.tsx`, `VistaDeServicio.tsx`
- `.gitignore`, `package.json` → `auditNotes`

## Ver también

- [[Integración MCP]] · [[Comandos y sandbox]] · [[Git endurecido]]
- [[Vista previa y proxy]] · [[Variables de entorno]] · [[Dependencias del sistema]]
