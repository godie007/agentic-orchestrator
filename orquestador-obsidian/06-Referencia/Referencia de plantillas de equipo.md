---
tags: [referencia, organización]
aliases: [PLANTILLAS_EQUIPO, plantillaEquipoSchema, plantillaRolSchema, MEJORADOR_DE_CODIGO, QA_MOVIL, plantillas.ts, Consultora de documentos, Estudio audiovisual, Lanzamiento y campaña, Desarrollo de software, Investigación y análisis]
---

# Referencia de plantillas de equipo

Las cinco plantillas de `packages/shared/src/plantillas.ts` —organigramas
extraídos de seeds que ya funcionaron— y los dos presets de agentes del chat del
IDE. Cómo se materializan en filas, y qué puede salir mal, está en
[[Plantillas de equipo]].

## Esquemas

### `plantillaRolSchema`

| Campo | Tipo | Default | Para qué |
|---|---|---|---|
| `nombre` | string ≥ 1 | — | nombre del rol; es la clave con la que otros roles lo citan en `reportaA` |
| `titulo` | string ≥ 1 | — | `Role.title` |
| `systemPrompt` | string ≥ 1 | — | instrucciones (en inglés, declarando salida en castellano) |
| `authority` | `AuthorityLevel` | — | |
| `reportaA` | string, nullable | — | **nombre** del jefe dentro de la misma plantilla |
| `departamento` | string ≥ 1 | — | nombre de un área de la plantilla |
| `maxTurns` | entero 1–50 | `8` | |
| `escalado` | `{tierMinimo, tierMaximo}` | — | rango del escalado por dificultad; el tier de reposo es el mínimo |
| `herramientas` | string[] | `[]` | **nombres** de herramientas del catálogo de la empresa |

### `plantillaEquipoSchema`

| Campo | Tipo | Default | Para qué |
|---|---|---|---|
| `id` | string 1–64 | — | lo que viaja como `plantillaId` |
| `nombre` | string 1–100 | — | lo que se ve en el alta |
| `descripcion` | string 1–500 | — | |
| `icono` | string ≥ 1 | — | nombre de ícono Lucide |
| `tipoDeEncargo` | string ≥ 1 | — | para qué clase de encargo sirve (tooltip del alta) |
| `departamentos` | `{nombre, proposito = ""}[]` | — | se crean en fila, o se reusan si ya existen con ese nombre |
| `roles` | `PlantillaRol[]`, mínimo 1 | — | |
| `mcpSugeridos` | string[] | `[]` | ids de la tienda MCP; **no se instalan solos** |
| `proveedores` | `ProviderId[]`, opcional | — | preferidos en orden; gana el primero configurado, si no `proveedorPreferido()` |

`plantillaEquipo(id)` busca por id y devuelve `null` si no existe.

## Constantes comunes

`SALIDA_ES` abre cada prompt: *"All your OUTPUT — messages, deliverables,
on-screen text — must be written in Spanish (castellano rioplatense). These
instructions are in English only for precision."* Sin esa línea, un prompt en
inglés arrastra la respuesta al inglés; lo fija un test.

`ESCALADO` —rangos por autoridad; "un executor no necesita el modelo del CEO"—:

| Autoridad | Mínimo | Máximo |
|---|---|---|
| `executive` | `standard` | `smart` |
| `manager` | `cheap` | `standard` |
| `executor` | `cheap` | `standard` |

Algunos roles lo pisan a mano (revisores y la tech lead suben a
`standard..smart`). Ningún `executor` llega a `smart` (test).

## `consultora` — Consultora de documentos

Ícono `file-text`. Para informes, propuestas comerciales, análisis de mercado,
documentación. Produce Word y PDF. MCP sugeridos: `memory`, `fetch`. Sin
proveedor preferido.

Áreas: **Dirección** (entiende el encargo, reparte, responde), **Consultoría**
(investiga y escribe), **Calidad** (revisa contra la fuente).

| Rol | Título | Autoridad | Reporta a | Área | Turnos | Escalado | Herramientas |
|---|---|---|---|---|---|---|---|
| Valentina | Directora | executive | — | Dirección | 8 | standard..smart | `web_search`, `fetch_url` |
| Julián | Consultor senior | manager | Valentina | Consultoría | 10 | cheap..standard | `web_search`, `fetch_url`, `buscar_en_entregables`, `calcular`, `export_docx`, `export_pdf` |
| Camila | Analista | executor | Julián | Consultoría | 8 | cheap..standard | `web_search`, `fetch_url`, `calcular` |
| Ernesto | Revisor | manager | Valentina | Calidad | 8 | standard..smart | `buscar_en_entregables`, `verificar_cifras`, `fetch_url` |

Qué pide cada prompt: la directora delimita, delega y da el visto bueno sin
escribir (convoca un especialista si falta una capacidad); el consultor arma la
estructura, versiona la misma clave y exporta; la analista verifica con fuente y
fecha y dice lo que no pudo confirmar; el revisor contrasta con
`verificar_cifras`, `check_activity` y la fecha del encabezado del ciclo.

## `estudio-audiovisual` — Estudio audiovisual

Ícono `clapperboard`. Videos institucionales, campañas, tutoriales filmados,
decks. MCP sugeridos: `filesystem`, `memory`.

Áreas: **Dirección creativa**, **Guion**, **Diseño** (láminas HTML),
**Realización** (exporta, mide y corrige).

| Rol | Título | Autoridad | Reporta a | Área | Turnos | Escalado | Herramientas |
|---|---|---|---|---|---|---|---|
| Rita | Directora creativa | executive | — | Dirección creativa | 8 | standard..smart | `read_output_file`, `list_output` |
| Bruno | Guionista | executor | Rita | Guion | 10 | cheap..standard | `export_slides` |
| Malena | Diseñadora de láminas | executor | Rita | Diseño | 12 | cheap..standard | `write_output_file`, `read_output_file`, `list_output`, `revisar_lamina`, `generar_imagen` |
| Sonia | Realizadora | manager | Rita | Realización | 12 | standard..smart | `export_video`, `export_video_estudio`, `export_video_clips`, `grabar_clip`, `inspeccionar_medio`, `extraer_cuadros`, `read_output_file`, `list_output`, `delete_files` |

El prompt del guionista trae las tres trampas del guion (sin encabezado arriba
del `#`, sin íconos solos en su renglón, un `**Nombre:**` por línea); el de la
diseñadora, las restricciones del kit (sin bucles infinitos, sin `<animate>`,
sin red, láminas transparentes); el de la realizadora, medir con
`inspeccionar_medio` y mirar con `extraer_cuadros` en vez de repetir lo que dijo
otra herramienta.

## `lanzamiento` — Lanzamiento y campaña

Ícono `rocket`. Lanzamientos de producto, campañas, kits de venta. MCP
sugeridos: `fetch`, `memory`.

Áreas: **Dirección de campaña**, **Contenido**, **Piezas**, **Distribución**.

| Rol | Título | Autoridad | Reporta a | Área | Turnos | Escalado | Herramientas |
|---|---|---|---|---|---|---|---|
| Federico | Director de campaña | executive | — | Dirección de campaña | 8 | standard..smart | `web_search`, `read_output_file`, `list_output` |
| Lucía | Redactora | executor | Federico | Contenido | 8 | cheap..standard | `web_search`, `fetch_url` |
| Marco | Productor de piezas | executor | Federico | Piezas | 12 | cheap..standard | `export_slides`, `export_video`, `generar_imagen`, `inspeccionar_medio`, `write_output_file`, `read_output_file`, `list_output` |
| Carolina | Distribución | executor | Federico | Distribución | 6 | cheap..standard | `send_email`, `list_output` |

La campaña termina cuando las piezas existen **y** el mail está redactado; la
distribución pide destinatarios con `request_context` en vez de adivinarlos.

## `desarrollo-software` — Desarrollo de software

Ícono `code-2`. Arreglar bugs, agregar funcionalidades, refactorizar un repo
existente. **Proveedores preferidos**: `claude-code`, `claude-sesion`,
`anthropic` (la suscripción trae su propio harness de edición). MCP sugeridos:
`context7`, `github`, `sequential-thinking`.

Áreas: **Dirección técnica**, **Desarrollo**, **Calidad**.

| Rol | Título | Autoridad | Reporta a | Área | Turnos | Escalado |
|---|---|---|---|---|---|---|
| Andrés | CTO | executive | — | Dirección técnica | 8 | standard..smart |
| Paula | Tech lead | manager | Andrés | Desarrollo | 14 | standard..smart |
| Tomás | Programador | executor | Paula | Desarrollo | 16 | cheap..standard |
| Irene | QA | executor | Andrés | Calidad | 10 | cheap..standard |

Herramientas:

| Rol | Herramientas |
|---|---|
| Andrés | `crear_repositorio`, `listar_repositorios`, `mapa_del_codigo`, `buscar_codigo`, `leer_codigo`, `estado_git`, `servicios`, `web_search` |
| Paula | `crear_repositorio`, `listar_repositorios`, `mapa_del_codigo`, `buscar_codigo`, `buscar_archivos`, `leer_codigo`, `editar_codigo`, `escribir_codigo`, `aplicar_parche`, `estado_git`, `revertir_codigo`, `ejecutar_comando`, `solicitar_comando`, `instalar_dependencia`, `servicios`, `probar_servicio`, `fetch_url`, `logs_del_telefono`, `estado_de_la_app` |
| Tomás | lo de Paula salvo `crear_repositorio` y `fetch_url`, más `archivos_de_la_app`, `consultar_base_de_la_app`, `captura_del_telefono`, `adb_diagnostico`, `reiniciar_app`, `limpiar_datos_de_la_app`, `explorar_telefono`, `manejar_app` |
| Irene | lectura de código (`listar_repositorios`, `mapa_del_codigo`, `buscar_codigo`, `buscar_archivos`, `leer_codigo`, `estado_git`), `ejecutar_comando`, `solicitar_comando`, `servicios`, `probar_servicio` y las del teléfono salvo `limpiar_datos_de_la_app` |

Irene **no** recibe herramientas que escriben código: nunca pide el arriendo y
puede verificar mientras otro corrige. Su prompt incluye el QA móvil (sólo
staging, tocar por texto, `esperar_texto` después de navegar, verificar contra
el servidor). Las herramientas del teléfono sólo existen con `adb` en la
máquina.

## `investigacion` — Investigación y análisis

Ícono `microscope`. Estudios de mercado, vigilancia tecnológica, informes de
coyuntura. MCP sugeridos: `fetch`, `duckduckgo`, `memory`.

Áreas: **Dirección**, **Investigación**, **Edición**.

| Rol | Título | Autoridad | Reporta a | Área | Turnos | Escalado | Herramientas |
|---|---|---|---|---|---|---|---|
| Silvia | Directora de investigación | executive | — | Dirección | 8 | standard..smart | `web_search`, `buscar_en_entregables` |
| Gastón | Investigador | executor | Silvia | Investigación | 10 | cheap..standard | `web_search`, `fetch_url`, `calcular` |
| Nora | Editora | manager | Silvia | Edición | 10 | cheap..standard | `buscar_en_entregables`, `verificar_cifras`, `export_docx`, `export_pdf` |

## MCP sugeridos, en la tienda

| Id | Nombre | Servidor | Comando | Credencial |
|---|---|---|---|---|
| `memory` | Memoria persistente | `memoria` | `npx -y @modelcontextprotocol/server-memory` | — |
| `fetch` | Fetch | `fetch` | `uvx mcp-server-fetch` | — |
| `filesystem` | Sistema de archivos | `archivos` | `npx -y @modelcontextprotocol/server-filesystem .` | — |
| `context7` | Context7 | `context7` | `npx -y @upstash/context7-mcp` | — |
| `github` | GitHub | `github` | `npx -y @modelcontextprotocol/server-github` | `GITHUB_PERSONAL_ACCESS_TOKEN` |
| `sequential-thinking` | Pensamiento secuencial | `pensamiento` | `npx -y @modelcontextprotocol/server-sequential-thinking` | — |
| `duckduckgo` | DuckDuckGo | `duckduckgo` | `uvx duckduckgo-mcp-server` | — |

Ver [[Referencia de la tienda MCP]].

## Presets del chat del IDE

No son parte de ninguna plantilla: se crean con un click desde el IDE, trabajan
solos en corridas enfocadas y sus prompts no hablan de delegar.

### `MEJORADOR_DE_CODIGO`

| Campo | Valor |
|---|---|
| `nombre` / `titulo` | "Mejorador de código" / "Mejora de código con IA" |
| `departamento` | "Desarrollo"; si el proyecto ya tiene áreas, va a la primera |
| herramientas | todas las de `HERRAMIENTAS_DE_CODIGO` presentes en el catálogo (código, comandos, servicios, repos y, con adb, teléfono; R2) |
| `maxTurns` | 20 |
| endpoint | `POST /api/companies/:companyId/mejorador` → `Runtime.crearMejorador` |

Prompt: el cambio más chico que logra lo pedido, el estilo del archivo, editar
por coincidencia exacta, verificar con los tests del repo (en la carpeta de la
parte, en un monorepo), mirar los logs del servicio si está levantado, depurar
en el teléfono antes de adivinar, y cerrar con qué cambió, qué corrió y qué
revisar.

### `QA_MOVIL`

| Campo | Valor |
|---|---|
| `nombre` / `titulo` | "QA móvil" / "Barridos de prueba de la app móvil" |
| `departamento` | "Calidad" (se crea si no existe, con propósito "Prueba lo que se construye antes de darlo por bueno.") |
| herramientas | `listar_repositorios`, `mapa_del_codigo`, `buscar_codigo`, `buscar_archivos`, `leer_codigo`, `estado_git`, `ejecutar_comando`, `solicitar_comando`, `servicios`, `probar_servicio`, las diez del teléfono, `r2_listar`, `r2_objetos` |
| `maxTurns` | 30 |
| endpoint | `POST /api/companies/:companyId/qa-movil` → `Runtime.crearQaMovil` |

Prompt: primero lee el skill de QA del repo (`SKILL.md` en `.claude/skills` o
`.agents/skills`) y traduce su mecánica de emulador a sus herramientas; arma la
matriz de casos desde el código; verifica precondiciones; corre cada caso
contrastando UI con la fuente de verdad (base local, API, bucket R2); sólo
staging; prefijo `QA-ORQ` en los datos creados; reporta Matriz, Hallazgos, Datos
de prueba y Pendiente. No edita código, así que nunca toma el arriendo. Ver
[[QA móvil]].

### Cómo se crean los dos

`Runtime.crearAgenteDelChat` (`apps/server/src/runtime.ts`):

- Es **idempotente por nombre**: si el rol existe, sólo le **suma** las
  herramientas que falten y lo refleja en las corridas vivas. No toca su prompt:
  un cambio en el preset no llega a un rol ya creado.
- Modelo: con `claude-code` configurado, `providerId: "claude-code"`,
  `modelSlug: "claude-code/opus"`; si no, `proveedorPreferido()` sin slug. En
  los dos casos `tier: "smart"`, `escalado: null`, `maxOutputTokens: 8192`.
- `authority: "executor"`, `reportsTo: null`.
- `Runtime.startRun` los pone al día antes de cada pedido enfocado que los usa:
  así una herramienta nueva (las del teléfono) les llega sin volver a crearlos.

## Qué fijan los tests

`packages/shared/src/plantillas.test.ts`:

- todas validan contra `plantillaEquipoSchema` y los ids no se repiten;
- `reportaA` y `departamento` apuntan a algo que existe en la plantilla;
- hay exactamente un `executive` por plantilla y no reporta a nadie;
- ningún `executor` llega a `smart`;
- los `mcpSugeridos` existen en `CATALOGO_MCP`;
- toda instrucción declara que la salida es en castellano;
- en `desarrollo-software`, QA y Programador tienen `explorar_telefono`,
  `manejar_app` y `captura_del_telefono`, y el prompt de QA los nombra;
- `plantillaEquipo` busca por id.

## Fuentes

- `packages/shared/src/plantillas.ts` — `plantillaRolSchema`, `plantillaEquipoSchema`, `SALIDA_ES`, `ESCALADO`, `PLANTILLAS_EQUIPO`, `MEJORADOR_DE_CODIGO`, `QA_MOVIL`, `plantillaEquipo`
- `packages/shared/src/tienda-mcp.ts` — artículos sugeridos
- `apps/server/src/runtime.ts` — `crearMejorador`, `crearQaMovil`, `crearAgenteDelChat`, `startRun`
- `apps/server/src/codigo-servidor.ts` — `HERRAMIENTAS_DE_CODIGO`
- `apps/server/src/rutas-codigo.ts` — endpoints `mejorador` y `qa-movil`

## Ver también

- [[Plantillas de equipo]]
- [[CU-11 Proyecto nuevo desde una plantilla]]
- [[Cómo agregar una plantilla de equipo]]
- [[Organización de agentes]]
- [[Chat de IA]]
