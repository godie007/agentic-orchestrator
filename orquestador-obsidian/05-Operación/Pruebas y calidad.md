---
tags: [operación, contribuir]
aliases: [Tests, Calidad, Vitest, typecheck, FakeProvider, noPersistence, armarEntorno, vitest.config.ts]
---

# Pruebas y calidad

Dos puertas, las dos manuales: `npm run typecheck` y `npm test`. No hay linter ni
hooks de git que las fuercen, y no hay CI en el repo. Los tests no gastan tokens
ni necesitan red: el motor recibe proveedor y persistencia inyectados.

## `typecheck` es la puerta de calidad

`npm run typecheck` = `tsc --build` sobre `tsconfig.json`, que sólo tiene
**referencias de proyecto** (shared → llm → tools → engine → server, y web). Cada
paquete es `composite` con `emitDeclarationOnly`, así que el build escribe `.d.ts`
y `.tsbuildinfo` en `dist/` (y `apps/web/dist-types/`), ignorados por git.

| Flag (`tsconfig.base.json`) | Qué atrapa |
|---|---|
| `strict` | lo de siempre |
| `noUncheckedIndexedAccess` | `array[0]` es `T \| undefined`: fuerza el `!` o el chequeo |
| `verbatimModuleSyntax` | `import type` donde corresponde; sin eso tsx/Vite importarían tipos en runtime |
| `isolatedModules`, `moduleDetection: "force"` | cada archivo compilable solo (tsx, esbuild) |
| `noImplicitOverride`, `noFallthroughCasesInSwitch` | `override` explícito, `case` sin `break` |
| `exactOptionalPropertyTypes: false` | apagado a propósito: por eso el código usa `...(x ? { x } : {})` |

Lo que **no** revisa: `claude-code-relay.mjs` (no es `.ts`) y los repos de
`data/`.

## Cómo corren los tests

```bash
npm test                                           # vitest run, todo el monorepo
npm run test:watch
npx vitest run packages/tools/src/router.test.ts   # un archivo
npx vitest run -t "cada mensaje queda atribuido"   # un caso
```

`vitest.config.ts` (raíz) hace tres cosas:

- **Excluye `data/**` y `**/dist/**`.** `data/` guarda los repos de los proyectos
  y los worktrees de los agentes: sus tests son de ellos, y vitest los levantaba
  como propios.
- **`ORQ_ESPERA_PROVEEDOR_MS=0`**: la espera entre ciclos fallidos (30 s, 60 s…)
  serían minutos esperando a un proveedor falso.
- Nada más: no hay jsdom. Los tests de la UI renderizan con
  `renderToStaticMarkup` y mockean Monaco con `vi.mock("./monaco.js")`.

`CI=1` no es de estos tests: es lo que el orquestador le inyecta a los comandos de
los agentes (`entornoDeComando`) para que el `npm test` **de un proyecto** no
arranque en watch.

Hay 70 archivos de test con unos 850 casos declarados (más los generados en
bucle). Uno se saltea solo: `codigo.test.ts` → "en el sandbox no se escribe fuera
del worktree ni en .git" usa `it.skipIf(!hayAislamiento())`.

## Las piezas que hacen posibles los tests

| Pieza | Dónde | Qué hace |
|---|---|---|
| `FakeProvider` | `packages/engine/src/testing/fake-provider.ts` | proveedor guionado: responde según el rol (`actorOf` lee "Sos X," del system); `alreadyActed` evita loops; `calls` guarda cada request para asertar |
| `makeCompany`, `makeRole`, `makeRun`… | `packages/engine/src/testing/factory.ts` | dominio válido en una línea |
| `noPersistence` | `packages/engine/src/state.ts` | `Persistence` nula: el motor corre sin disco |
| `armarEntorno`, `envDePrueba`, `proveedorFalso` | `apps/server/src/testing/entorno.ts` | tmpdir + `Store` SQLite real + `Runtime`; un proveedor que falla si alguien lo usa sin guion |
| `construirApp` + `app.inject` | `apps/server/src/app.ts` | HTTP de verdad sin socket, con el mismo armado que producción |
| git real con `GIT_CONFIG_GLOBAL=/dev/null` | tests de repos, scm, renombrar, ide | los tests necesitan el binario `git` |

La fecha entra formateada desde el llamador (render de documentos, prompt, vault):
por eso esos tests son deterministas. Ver
[[ADR-003 Motor desacoplado del servidor]].

## Qué fija cada archivo

### `packages/engine`

| Archivo | Qué fija |
|---|---|
| `scheduler.test.ts` | la cadena avanza en un ciclo; jerarquía al asignar; corte por presupuesto; esperar/retomar solicitudes; pausar el modo continuo; no convocar al que habla sin hacer; corrida vacía ≠ éxito (y un pedido de código o una consulta del chat sí cuentan); corte cuando el proveedor rechaza todo; **atribución con 4 agentes concurrentes**; aprobar ejecuta la llamada aprobada, rechazar no |
| `loop.test.ts` | corte por llamada fallida repetida; timeout con reintento (un stop no se reintenta); turno cortado se retoma; presupuesto dinámico de iteraciones; memo de lecturas (escribir invalida, un argumento inventado no lo engaña); contexto acotado; escalado por dificultad y `modelSlug` fijo; espacio de código del turno |
| `memory.test.ts` | lecciones en el prompt con tope por cantidad y tamaño; dedupe y confirmación por otro autor; presión de cierre; persistencia con ámbito empresa; un agente caído no tumba la corrida; `turn_end` aun fallando; roles incorporados; refutadas fuera del prompt, con procedencia |
| `continuidad.test.ts` | tareas heredadas (adopción, origen, primer ciclo); orden por urgencia; dos agentes que se escriben corren una vez cada uno |
| `claude-mcp.test.ts` | puente MCP del org: prefijo `mcp__orq__`, delegación, puntero de relectura e invalidación tras escribir, recorte de resultados, freno por largo |
| `acotar.test.ts` | `acotarResultado` no toca entregables reales, conserva el final, sugiere sólo argumentos declarados |
| `dificultad.test.ts` | `elegirTierPorDificultad`: mínimo/máximo, monotonicidad, rango, fallos con tope 2 |
| `roles.test.ts` | `removeRole` (solicitudes, reportes, mensajes, turnos); entregables compartidos entre áreas y versionado |
| `state.test.ts` | pedidos sin responder se reencolan con tope |

### `packages/llm`

| Archivo | Qué fija |
|---|---|
| `registry.test.ts` | nada sin credenciales; interruptores de `claude-sesion` y `claude-code`; **borra una `ANTHROPIC_API_KEY` vacía**; Bearer + beta OAuth; error que nombra los configurados |
| `adapters/claude-code.test.ts` | catálogo sin precios; **sólo lectura sobre la salida**; en código nunca `Bash`, `Edit/Write` sólo con arriendo, `.git` negado; `entornoDelCli` sin credenciales; rescate de texto; fallback, reintentos 4, aviso de ventana, vigilante de silencio; `ENABLE_TOOL_SEARCH` apagado |
| `adapters/opencode.test.ts` | slugs tal cual; sin escritura sobre la salida, `edit`/`bash` negados, `"*": false`; args sin interacción; lectura de la salida JSON; tiers por mapa; rescate al corte |
| `adapters/caching.test.ts` | breakpoints de caché de prompt (Anthropic y compatibles OpenAI) |
| `modelos-claude.test.ts` | precios curados por prefijo; `resolverTierEstatico`; un `modelSlug` fijo gana |
| `ledger.test.ts` | costo informado vs catálogo; cero es cero; sin precio no inventa; el presupuesto corta |

### `packages/tools`

| Archivo | Qué fija |
|---|---|
| `coordination.test.ts` | argumentos obligatorios y JSON truncado; claves-variante; calidad de `write_artifact`; `check_activity`; `edit_artifact` atómico; `assign_task`/`update_task`/`send_message`; `convocar_especialista` (autoridad, tope, faltantes); `solicitar_servidor_mcp` sanea secretos; `estado_del_proceso`; `read_artifact` entero; **`record_lesson` exige evidencia** |
| `router.test.ts` | coordinación y habilidades no compiten por el ranking |
| `compuestas.test.ts` | `crear_herramienta`: parámetros, corte en el paso que falla, frenos (autoridad, asignadas, sin aprobación, sin anidar) |
| `busqueda.test.ts` | bloques y secciones literales; buscar en vez de leer; índice sólo para lo realmente grande |
| `calculo.test.ts` | números como los escribe la gente, sin `eval`; `verificar_cifras` caza márgenes mal atribuidos |
| `contexto.test.ts` | `leer/buscar/escribir_contexto`; el mapa en el prompt sin contenido |
| `mcp/bridge.test.ts` | fila por servidor; reconocimiento y espera de límites de tasa |
| `codigo/codigo.test.ts` | `resolverEnWorktree` (sin `.git`, sin symlinks fuera); leer/editar/parchear; búsqueda y mapa; `ejecutar_comando` (allowlist, exit≠0 es resultado, **sin credenciales y con `CI=1`**, mata el grupo, sandbox); `instalar_dependencia` |
| `codigo/telefono.test.ts` | `explorar_telefono` y `manejar_app` validan y transmiten el motivo de un rechazo |
| `codigo/pasos-app.test.ts` | pasos de QA por texto, sin coordenadas, acotados |
| `skills/skills.test.ts` | markdown a bloques; .docx y .pdf reales (portada, numeración, sin páginas en blanco); registro condicionado a navegador; un archivo por entregable sin versión en el nombre; borrado por `kind`; `write_output_file` |
| `skills/guion.test.ts` | `parseGuion` (portada, diálogo, íconos, imágenes, música); deck HTML sin inyección; pronunciación por palabra entera; reparto de voces |
| `skills/estudio.test.ts` | láminas por número; planificación de ventanas; `construirSonido` (aresample después de loudnorm, ducking) |
| `skills/clips.test.ts` | clips por número (00 = portada); cortes; `tpad` antes de `trim`; sesión de navegador saneada y compartida; informe de exploración |
| `skills/medios.test.ts` | ficha de ffprobe; **aviso de video sin audio** |
| `skills/permisos.test.ts` | `puedeBorrar` por autoridad y que el lote no saltee la jerarquía |
| `skills/gate.test.ts` | nada con plata se exporta sin `verificar_cifras` |

### `packages/shared`

| Archivo | Qué fija |
|---|---|
| `mcp-config.test.ts` | `parsearConfigMcp`: formato estándar y mapa a secas; **un secreto literal no se guarda**; headers como referencia |
| `tienda-mcp.test.ts` | catálogo válido; ningún env del transporte con pinta de secreto; toda variable declarada en `envRequeridas` |
| `argv.test.ts` | `tokenizar` sin shell; `empiezaCon` por token; prefijos que lo permiten todo; git de lectura vs escritura |
| `dependencias.test.ts` | sólo paquetes del registro; siempre `--ignore-scripts`; gestor por lockfile |
| `programacion.test.ts` | próximo disparo estrictamente posterior; cron con OR; inválido → `null` |
| `servicios.test.ts` | `clasificarServicio` (Expo gana a Vite); `redirigirUrlsLocales`; `parsearDotenv` |
| `plantillas.test.ts` | plantillas válidas, un solo executive, ningún executor en `smart`, instrucciones en inglés con salida en castellano |

### `apps/server`

| Archivo | Qué fija |
|---|---|
| `db.test.ts` | borrar rol/corrida (**los entregables sobreviven**); residuos que se anuncian exactos; resumen de proyectos; cascada de MCP; trabajo abierto; saneo de corridas huérfanas |
| `exports.test.ts` | `safePath`; carpetas; qué borra un agente (manifiesto); vista previa de docx; limpieza sin crear lo que mide; el logo se conserva |
| `directorios.test.ts` | carpeta legible con marca; `package.json` commonjs; renombrar sin carpeta nueva; mudanza de layout idempotente |
| `repos.test.ts` | **el `.git` original no se toca**; checkpoints sin `.env`; integrar/descartar; instantáneas; carpeta sin git; `validarUrlGit`; guardar con hash; respaldos |
| `scm.test.ts` | preparar, commit, amend, stash, ramas y fusión con conflicto; la rama de la persona nunca se pisa |
| `renombrar.test.ts` | renombrar proyecto (worktrees reparados, vault) y repo |
| `git.test.ts` | lock ocupado: espera y commitea; uno que no se suelta es error |
| `ide.test.ts` | agente del chat y corrida enfocada; deshacer; **vista previa con CORS sólo para sí**; **CORS de la API**; reutilizar comandos; dependencia revalidada al aprobar |
| `routes.test.ts` | memoria por HTTP: 400 de Zod, dedupe, refutar, borrar espeja el vault |
| `servicios.test.ts` | la vista previa habla con su backend, **secretos tapados en logs**; detener y caídas; `detectarServicios` |
| `proxy-vista.test.ts` | inyección del selector; websockets; 502 explicado; la sonda habla sólo al origen que saludó; sin backticks |
| `ws.test.ts` | WebSocket del espejo; **rechaza otro origen** |
| `mcp-oauth.test.ts` | tokens en archivo **0600**; olvidar el servidor borra el archivo |
| `dispositivos.test.ts` | parseo de adb y mDNS; vínculo sólo con el nombre del QR; túneles; escribir escapado |
| `scrcpy.test.ts` | bytes del protocolo como los tests de scrcpy |
| `depuracion-movil.test.ts` | rutas en el sandbox de la app; SQL de lectura; diagnósticos atados a la app; **credenciales tapadas**; crashes desde el comienzo |
| `qa-movil.test.ts` / `qa-movil-storage.test.ts` | ubicar por texto; **producción: se niega sin decir el valor**; app al frente y pantalla prendida; esperas por reloj |
| `r2.test.ts` | firma SigV4 con vectores de AWS; nunca devuelve llaves; no consulta producción |
| `aab.test.ts` | versión, manifiesto protobuf, certificados, bundle apuntando a staging no pasa; builds viejos |
| `contexto.test.ts` | vault: rutas saneadas, mapa, notas legibles en Obsidian |
| `auditoria.test.ts` | reglas de `auditarCorrida` |
| `equipo.test.ts` | `generarEquipo` con habilidades y herramientas de código |
| `roles-vivos.test.ts` | una herramienta otorgada llega a la corrida viva; `crearQaMovil` sin herramientas que escriben |
| `memoria-persistida.test.ts` | memoria persiste, llega al prompt, refutar la saca sin borrarla |
| `conversacion.test.ts` | `historiaDeConversacion` por conversación |

### `apps/web`

| Archivo | Qué fija |
|---|---|
| `routes/codigo/Markdown.test.tsx` | el chat **no ejecuta HTML crudo ni enlaces `javascript:`** |
| `routes/codigo/Nota.test.tsx` | enlaces y callouts de Obsidian |
| `routes/codigo/sonda.test.ts` | el inspector saca archivos propios del stack |
| `lib/progreso.test.ts` | reloj y alarmas de silencio de una corrida |
| `ui/modelo.test.ts` | familia y nombre corto de un modelo |

## Tests que existen por un incidente

| Test | Incidente |
|---|---|
| atribución con 4 agentes concurrentes (`scheduler.test.ts`) | actor mutable en `RunState`: mensajes firmados por el rol equivocado |
| router: habilidad asignada nunca afuera | un agente perdía su propia `export_pdf` frente a tools de MCP |
| borrar corrida conserva entregables (`db.test.ts`) | limpiar la lista le costaba a la empresa su trabajo |
| próximo disparo estrictamente posterior | una misión se redisparaba en el mismo minuto |
| diálogo en un solo párrafo (`guion.test.ts`) | el primero en hablar decía las cuatro líneas |
| argumento inventado y memo (`loop.test.ts`) | 534k tokens de entrada para 2k de salida |
| `record_lesson` exige evidencia | una lección falsa ("edit_artifact está rota") entró a la memoria |
| `.git` original intacto (`repos.test.ts`) | un worktree directo escribe en el `.git` de la persona |
| lock ocupado (`git.test.ts`) | un checkpoint falló con "index.lock: File exists" |

## Lo que no cubren

- Una corrida contra un **LLM real** (ni de pago ni por suscripción).
- El `.mp4` final: se prueban los planes y las cadenas de filtros, no ffmpeg
  corriendo.
- Chrome, adb, scrcpy y el teléfono de verdad: se prueban parseos y reglas con
  funciones de ejecución falsas.
- La mayor parte de la UI (sólo los cinco archivos de arriba).

## Antes de un commit

```bash
npm run typecheck && npm test
```

Nada lo fuerza. Cuándo hace falta un test nuevo, en [[Guía de contribución]].

## Fuentes

- `tsconfig.base.json`, `tsconfig.json`, `packages/*/tsconfig.json`, `apps/*/tsconfig.json`
- `vitest.config.ts`
- `packages/engine/src/testing/fake-provider.ts`, `factory.ts`; `packages/engine/src/state.ts` → `noPersistence`
- `apps/server/src/testing/entorno.ts`; `apps/server/src/app.ts` → `construirApp`
- los 70 `*.test.ts(x)` listados

## Ver también

- [[Comandos]] · [[Guía de contribución]] · [[Trampas conocidas]] · [[Seguridad]]
