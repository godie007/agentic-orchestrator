---
tags: [referencia, organización]
aliases: [Seeds, Codytion, Empresas sembradas, seed.ts, db:seed, db:estudio, db:inspia, db:observatorio]
---

# Empresas de ejemplo

Cinco seeds, cada uno una empresa armada para demostrar algo distinto. Son
organigramas probados: de ellos salieron las [[Plantillas de equipo]]. Qué
necesita cada comando para correr está en [[Comandos]].

## Resumen

| Empresa | Comando | Archivo | Roles | Proveedor y modelo | Tope | Demuestra |
|---|---|---|---|---|---|---|
| Codytion S.A. | `npm run db:seed` | `apps/server/src/seed.ts` | 7 | `openrouter`, tiers `smart`/`standard`/`cheap` | US$1 | delegación en cascada, umbral de aprobación, MCP visible ([[CU-01 Propuesta comercial]]) |
| Codytion (estudio) | `npm run db:estudio` | `scripts/seed-estudio-codytion.ts` | 6 | `ORQ_SEED_*`; por defecto `claude-code/sonnet` o `openrouter` en tier `free` | US$3 | guion → revisión → láminas → video ([[CU-02 Video institucional]]) |
| INSPIA — Lanzamiento | `npm run db:inspia` | `scripts/seed-inspia-lanzamiento.ts` | 4 | `claude-sesion`: Opus 5, Sonnet 5, Haiku 4.5 | US$5 | tres modelos según el criterio que pide cada rol |
| INSPIA — Publicidad | `npm run db:inspia-publicidad` | `scripts/seed-inspia-publicidad.ts` | 6 | `claude-code` con **escalado por rango** | US$5 | filmar una app real y controlar lo filmado ([[CU-09 Tutorial filmado sobre una app real]]) |
| Observatorio de IA | `npm run db:observatorio` | `scripts/seed-observatorio-ia.ts` | 5 | `claude-code/opus` y `/sonnet` fijos | US$5 | verificación independiente de cada dato |

## Cómo arma un seed su catálogo

Todos siguen la misma receta, y tiene tres consecuencias que no se ven leyendo
un solo seed:

1. **Registran capacidades y habilidades en la tabla `tools`.** Arman un
   `ToolRegistry`, le suman `createSkillTools(...)` y guardan lo de origen
   `capability` o `skill` con un id nuevo. Sin esa fila, `role.toolIds` no puede
   apuntar a nada: `db:seed` filtraba sólo `capability` y sus roles no podían
   exportar un PDF.
2. **Las de coordinación se otorgan siempre** (`ToolRegistry.forRole`). Nombrar
   `write_artifact`, `read_artifact`, `check_activity` o `calcular` en `toolIds`
   no cambia nada: el helper `herramientas(...)` las descarta porque no están en
   el catálogo. Lo que decide un rol son sus capacidades y habilidades.
3. **Lo que depende de la máquina se evalúa al sembrar.** Sin Chrome, el catálogo
   no trae `export_video_estudio`, `revisar_lamina`, `grabar_clip`,
   `explorar_pantalla` ni `export_video_clips`, y esos ids se descartan en
   silencio de los roles. Varios seeds pasan `generadorImagenes: null`, así que
   `generar_imagen` nunca entra. El log final lista qué quedó en cada rol ("sólo
   coordinación" cuando no hay nada propio).

Los servidores MCP se guardan configurados pero **sus herramientas recién existen
cuando el servidor conecta**: un seed no puede escribir sus ids. Ninguno es
idempotente: correrlo de nuevo da otra empresa con el mismo nombre.

## Codytion S.A. — `npm run db:seed`

Una consultora de software de Bogotá (40 personas, proyectos de US$30.000 a
US$250.000, margen objetivo 35 %). Armada para que el proceso se note: delegación
en cascada, un escalamiento probable a la CEO, un umbral en Finanzas y dos MCP
conectados.

- **Voz y marca**: `unaSolaVoz: true`, "Codytion" se pronuncia "códishon"; acento
  `#40a0f8`, panel `#232f4d`.
- **Departamentos**: Dirección, Comercial, Operaciones, Finanzas, Marketing,
  Soporte.
- **Modelo**: todos `openrouter` con tier y `maxOutputTokens: 4096`.

| Rol | Título | Autoridad | Reporta a | Tier | `maxTurns` | Capacidades y habilidades |
|---|---|---|---|---|---|---|
| Valentina Ríos | CEO | `executive` | — | **`smart`** | 10 | `web_search`, `fetch_url` |
| Mateo Duarte | Director Comercial | `manager` | CEO | `standard` | 8 | web + `export_docx`, `export_pdf`, `list_output` |
| Sofía Marín | Directora de Operaciones | `manager` | CEO | `standard` | 8 | — |
| Diego Salas | Arquitecto de Soluciones | `executor` | Sofía | `standard` | 8 | web |
| Camila Ortega | Directora Financiera | `manager` | CEO | `standard` | 8 | — (umbral `spendApprovalThresholdUsd: 5000`) |
| Julián Prieto | Líder de Marketing | `executor` | CEO | `standard` | 8 | web |
| Renata Gil | Líder de Soporte | `executor` | CEO | **`cheap`** | 8 | — |

**Políticas** (todas con `gate: null`): *Margen mínimo* (nada sale bajo 35 % sin
aprobación de la CEO), *Estimaciones fundamentadas* (sólo Operaciones y el
arquitecto: desglose por módulo y perfil con supuestos) y *Una sola propuesta*
(clave `propuesta-comercial`, versionada).

**MCP**: `archivos` (`@modelcontextprotocol/server-filesystem` sobre
`data/workspace/`, que el seed crea) y `memoria` (`server-memory`), los dos por
`npx`, sin credenciales y con `autoApproveTools`.

Qué vale copiar:

- **La CEO en `smart`, Soporte en `cheap`**: quien decide paga más, quien aporta
  contexto conocido paga menos. Ver [[Capa LLM y tiers]].
- **El prompt de la CEO le prohíbe ejecutar** ("decidir y desbloquear, no
  ejecutar"): sin eso un ejecutivo se pone a trabajar en vez de delegar.
- **La exportación sólo en quien cierra la propuesta**: dársela a todos produce
  cuatro versiones del mismo documento.

## Codytion (estudio audiovisual) — `npm run db:estudio`

El equipo mínimo que produce **un** video de marketing, y el que más muestra el
circuito de calidad. La empresa se llama "Codytion" y habla **castellano de
Colombia** (usted, sin voseo): es un dato de la marca, está en el contexto y se
repite en cada rol que escribe. Las instrucciones de los roles están en inglés,
con la línea de idioma de salida arriba de todo. Ver
[[Organización de agentes]].

- **Voz**: `unaSolaVoz: false` (la pieza tiene un diálogo cliente–Codytion) y un
  léxico de pronunciación (Codytion, IA, IoT, RAG, API, cloud, DevOps, software).
- **Departamentos**: Marca, Contenido, Producción.
- **Modelo**: `ORQ_SEED_PROVEEDOR` (por defecto `claude-code` si
  `ORQ_CLAUDE_CODE` está prendido, si no `openrouter`), `ORQ_SEED_MODELO` (por
  defecto `claude-code/sonnet` con Claude Code), tier `ORQ_SEED_TIER` (por defecto
  `free`: una cuenta sin crédito contesta 402 a todo), `maxOutputTokens: 6000`.

| Rol | Título | Autoridad | Área | `maxTurns` | Capacidades y habilidades |
|---|---|---|---|---|---|
| Valentina Ríos | Directora de marca | `executive` | Marca | 10 | `list_output` |
| Camilo Restrepo | Investigador de mercado | `executor` | Contenido | 10 | `web_search`, `fetch_url` |
| Julián Prieto | Guionista | `manager` | Contenido | 10 | `fetch_url` |
| Mariana Losada | Revisora de guion | `manager` | Contenido | 8 | — |
| Tomás Iriarte | Diseñador de escenas | `executor` | Producción | 14 | `write_output_file`, `read_output_file`, `revisar_lamina`, `list_output` |
| Nadia Bercovich | Realizadora | `executor` | Producción | 10 | `export_video_estudio`, `export_video`, `export_slides`, `inspeccionar_medio`, `list_output` |

Todos reportan a la directora. El circuito: la directora abre una tarea por paso
con `assign_task`; el investigador escribe `investigacion-mercado` con fuentes;
el guionista escribe `video-codytion` (7–9 escenas, 75–95 s); la revisora
devuelve correcciones con `reply` —nunca pisa el guion—; el diseñador programa
una lámina HTML por escena, la revisa con `revisar_lamina` y **mira** la
previsualización; la realizadora filma con `export_video_estudio` y la pista
"Corporate Harmonics 1.49" (tiene que existir en `MUSICA_DIR`), arma el deck y
**mide** con `inspeccionar_medio` antes de informar. Sin navegador, cae a
`export_video` y lo dice.

**Políticas** (5): *El trabajo se ve en el tablero*, *Hablamos como en Colombia*,
*Un solo guion*, *Sólo lo que podemos sostener*, *Se revisa antes de filmar*
(directora, realizadora y diseñador).

Qué enseña: la directora audita y no escribe; la revisora sólo lee —un revisor
que escribe termina reescribiendo—; producir queda abierto a los ejecutores, pero
no pueden borrar.

## INSPIA — Lanzamiento — `npm run db:inspia`

Un spot de **60 segundos** para lanzar INSPIA (inspecciones eléctricas RETIE y
RETILAP) a cadenas de retail, con el motor ASS. Cuatro roles y tres modelos por la
sesión de Anthropic (`claude-sesion`, slugs fijos, `maxOutputTokens: 8192`):
decidir con Opus, escribir y revisar con Sonnet, filmar con Haiku —filmar no pide
criterio, pide no equivocarse con las claves—.

| Rol | Título | Autoridad | Modelo | Capacidades y habilidades |
|---|---|---|---|---|
| Valentina Ríos | Directora de campaña | `executive` | `claude-opus-5` | `list_output` |
| Julián Prieto | Guionista | `manager` | `claude-sonnet-5` | — (escribe `guion-lanzamiento` con las de coordinación) |
| Mariana Losada | Revisora | `manager` | `claude-sonnet-5` | — |
| Nadia Bercovich | Realizadora | `executor` | `claude-haiku-4-5-20251001` | `export_video`, `list_output` |

Departamentos: Estrategia, Contenido, Producción. Políticas: *Sesenta segundos*
(140–160 palabras de voz en off en total), *Se revisa antes de filmar*, *Un solo
guion*. Voz: una sola, con pronunciación de INSPIA, RETIE y RETILAP. Para
correrla hace falta `ORQ_CLAUDE_SESION` prendido y el token exportado.

## INSPIA — Publicidad — `npm run db:inspia-publicidad`

Una pieza comercial de 2–3 minutos **filmada sobre la aplicación real en
staging**, un clip por escena, con narración y música: el motor de clips. El
contexto insiste en que INSPIA es un motor de inspección **multisector** (lo
eléctrico es el ejemplo visual, no el alcance) y trae las frases aprobadas de la
marca.

- **Modelo**: `claude-code`, `modelSlug: null` y **escalado por dificultad** con
  rango: `smart..smart` para quien decide (directora, guionista, calidad),
  `standard..standard` para quien ejecuta. Ver [[Escalado por dificultad]].
- **Departamentos**: Dirección, Contenido, Producción, Calidad. Marca `#f85601`
  sobre `#082d52`.

| Rol | Título | Autoridad | Rango | `maxTurns` | Capacidades y habilidades |
|---|---|---|---|---|---|
| Valentina Ríos | Directora de la pieza | `executive` | smart | 10 | `read_output_file`, `list_output`, `inspeccionar_medio` |
| Camilo Restrepo | Investigador de producto | `executor` | standard | 6 | `list_output`, `read_output_file` (+ MCP `obsidian`) |
| Lucía Fernández | Guionista publicitaria | `manager` | smart | 12 | — |
| Diego Salas | Director de rodaje | `manager` | standard | 16 | `grabar_clip`, `export_video_clips`, `inspeccionar_medio`, `extraer_cuadros`, `write_output_file`, `read_output_file`, `list_output`, `delete_files` (+ MCP `playwright`) |
| Marina Quiroga | Control de calidad | `manager` | smart | 12 | `extraer_cuadros`, `inspeccionar_medio`, `read_output_file`, `list_output` |
| Sofía Marín | Supervisora de producción | `manager` | standard | 6 | `list_output`, `read_output_file`, `inspeccionar_medio` |

El director de rodaje es `manager` y no `executor` a propósito: tiene que poder
dar de baja sus propias tomas; con `executor` la cadena se trababa en el primer
clip a reemplazar. La supervisora existe para que la segunda corrida no empiece
de cero: mira `estado_del_proceso` y reasigna lo trabado. Ver
[[Supervisión y continuidad]].

**MCP**: `obsidian` (HTTP a `127.0.0.1:27123/mcp/` del plugin Local REST API,
header `Authorization` por referencia a `OBSIDIAN_BEARER`) y `playwright`
(`@playwright/mcp` con `--output-dir` en `salida/reconocimiento` del proyecto).
Al terminar imprime el `curl` que conecta los MCP; sus herramientas hay que
asignarlas después.

**Memoria sembrada**: seis lecciones (`inspia-acceso`, tres de
`grabar-clip-inspia`, `export-video-clips`, `inspia-datos-demo`): navegar por URL
absoluta, esperar la hidratación de las tablas, no pisar un clip bueno con uno de
sondeo, contar escenas contra secciones y filmar en el orden del flujo real.

**Políticas**: *Sólo se promete lo que se ve*, *Se reconoce antes de filmar*,
*Nada se aprueba sin mirarlo*, *El avance se ve en el tablero*.

> [!warning] Credenciales de staging en el repo
> La lección `inspia-acceso` trae las cuentas del tenant demo de staging con su
> contraseña, y el script está versionado. Sólo sirve si esas credenciales son
> descartables.

> [!note] El seed es anterior a la sesión reutilizable
> Sus instrucciones dicen que cada `grabar_clip` abre un navegador sin sesión y
> mandan a reconocer con Playwright. Hoy `grabar_clip` acepta `sesion` y existe
> `explorar_pantalla` sobre el mismo navegador de la cámara; el seed no los usa.
> Ver [[Motor de clips grabados]].

## Observatorio de IA — `npm run db:observatorio`

Un equipo de análisis, no de marketing: lee una noticia técnica y explica qué
implica, y **ningún dato entra porque alguien lo leyó una vez**. El investigador
busca; la verificadora vuelve a buscar el mismo dato desde la fuente original y
tiene prohibido creerle al primero.

| Rol | Título | Autoridad | Modelo | Capacidades y habilidades |
|---|---|---|---|---|
| Irene Salcedo | Directora de análisis | `executive` | `claude-code/opus` | `read_output_file`, `list_output` |
| Mateo Aguirre | Investigador principal | `executor` | `claude-code/sonnet` | `fetch_url`, `web_search` + navegador |
| Paula Restrepo | Verificadora de datos | `manager` | `claude-code/opus` | `fetch_url` + navegador |
| Andrés Villamil | Analista | `executor` | `claude-code/opus` | `export_pdf`, `export_docx`, `read_output_file`, `list_output` |
| Lucía Ferrer | Diseñadora de la presentación | `executor` | `claude-code/sonnet` | `export_slides`, `read_output_file`, `list_output`, `write_output_file` |

Departamentos: Dirección, Investigación, Publicación. Políticas: *Ningún dato con
una sola lectura* (CONFIRMADO / IMPRECISO / NO CONFIRMADO), *Las cuentas se
calculan* (con `calcular`, nunca de memoria), *El navegador es de sólo lectura*
(investigador y verificadora: nada de iniciar sesión, enviar ni comprar) y
*Hablamos como en Colombia*.

**MCP**: `browsermcp` (`npx @browsermcp/mcp@latest`, necesita la extensión en
Chrome). Es el único seed que **habla con el servidor**: al final pide
`GET /api/companies/<id>/tools` en `ORQ_API` (eso dispara el descubrimiento) y le
asigna por `PATCH` seis herramientas `mcp__browsermcp__browser_*` al investigador
y a la verificadora. Con el servidor apagado lo avisa y hay que asignarlas desde
el Hub.

## Armar la tuya

| Camino | Cuándo |
|---|---|
| **Plantilla** desde `/proyectos` (`POST /api/companies` con `plantillaId` → `Runtime.generarEquipo`) | lo normal: nombra las herramientas que faltan en la máquina. Ver [[Plantillas de equipo]] y [[Referencia de plantillas de equipo]] |
| **Pantalla Empresa** | ajustar a mano. Ver [[Pantalla Empresa y organigrama]] |
| **Blueprint**: `GET /api/companies/:id/blueprint` → editar → `POST /api/companies/import` | copiar una empresa a otra máquina o versionarla en git |
| **Roles a un click** | el "Mejorador de código" del chat y "QA móvil" se crean desde el IDE ([[Chat de IA]], [[QA móvil]]) |

El blueprint lleva empresa, departamentos, roles, políticas, servidores MCP (con
referencias, sin valores), las herramientas built-in (las de MCP se redescubren) y
los repos de origen git sin `baseSha`, sin permisos de una vez y sin
`archivosEntorno`. **No** lleva memoria, corridas ni salida. El import remapea
todos los ids.

### Lista de control

- [ ] `context` con los números que importan (márgenes, rangos, clientes) y, si
      hay voz, el idioma de salida
- [ ] quien coordina, **nunca en `cheap`**
- [ ] habilidades en la tabla `tools` **y** en `toolIds`, sembradas en una
      máquina que tenga lo que piden (Chrome, claves de imágenes)
- [ ] `reportsTo` coherente: la jerarquía se valida en código
- [ ] tareas con `assign_task`, no sólo mensajes: el tablero es lo que se hereda
- [ ] memoria sembrada con lo que ya costó caro
- [ ] credenciales por referencia; nada real dentro de un seed versionado

## Fuentes

- `apps/server/src/seed.ts`
- `scripts/seed-estudio-codytion.ts`, `scripts/seed-inspia-lanzamiento.ts`,
  `scripts/seed-inspia-publicidad.ts`, `scripts/seed-observatorio-ia.ts`, `scripts/start.sh`
- `packages/tools/src/registry.ts` → `ToolRegistry`, `forRole`; `packages/tools/src/skills/index.ts` → `createSkillTools`
- `apps/server/src/routes.ts` → `/api/companies/:id/blueprint`, `/api/companies/import`, `/api/plantillas`

## Ver también

- [[Modelo de dominio]] · [[Organización de agentes]] · [[Memoria de la empresa]]
- [[Casos de uso]] · [[Comandos]] · [[Plantillas de equipo]]
