---
tags: [referencia, dominio]
aliases: [Esquemas, Zod, schema.ts, Tipos del dominio, idSchema, timestampSchema, providerIdSchema, modelTierSchema, modelInfoSchema, newId, ids]
---

# Referencia de esquemas

Todo el dominio del orquestador está escrito en **Zod**, en `packages/shared`.
El servidor valida contra estos esquemas, la UI infiere sus tipos de acá y una
empresa entera se serializa a JSON con ellos (`CompanyBlueprint`). Un campo nuevo
se agrega **acá primero**: es la regla de [[ADR-002 Zod como única fuente de verdad]].

Esta nota es el índice y lo transversal —primitivos, identificadores, dónde se
valida y dónde no, payloads de la API—. El detalle campo por campo está partido
en cuatro notas:

| Nota | Qué cubre |
|---|---|
| [[Esquemas de empresa y organización]] | `ModelSelection` (con `escalado`), `Company`, `Voz`, `Marca`, `Department`, `Role`, `Policy`, `Programacion`, `Mision`, `Learning`, `CompanyBlueprint` |
| [[Esquemas de corrida y trabajo]] | `Run` (con `foco`), `esCorridaTerminal`, `Message`, `Task`, `Artifact`, `ApprovalRequest`, `AgentRequest`, `RoleProposal`, `LedgerEntry`, `createRunSchema` y los payloads de corrida |
| [[Esquemas de herramientas y MCP]] | `Tool` (con `composicion`), `McpTransport`, `McpServer`, `McpServerHealth`, la tienda (`ArticuloDeTienda`) y el importador de `mcpServers` |
| [[Esquemas de código y servicios]] | `argvSchema`, `Repositorio`, `OrigenRepositorio`, `ComandosRepositorio`, `Servicio`, `SesionCodigo`, y las reglas puras de `argv.ts`, `dependencias.ts` y `servicios.ts` |

Los esquemas de las plantillas de equipo están en
[[Referencia de plantillas de equipo]]; los de los eventos, en
[[Referencia de eventos]]. Qué significa cada entidad y cómo se relacionan:
[[Modelo de dominio]].

## Dónde viven

| Archivo | Qué define |
|---|---|
| `packages/shared/src/schema.ts` | el dominio: primitivos, empresa, código, herramientas y MCP, ejecución, solicitudes, memoria, costos, blueprint y payloads de la API (1.101 líneas) |
| `packages/shared/src/events.ts` | `traceEventSchema`: las 18 variantes de la traza |
| `packages/shared/src/plantillas.ts` | `plantillaRolSchema`, `plantillaEquipoSchema` y los presets |
| `packages/shared/src/tienda-mcp.ts` | `categoriaDeTiendaSchema`, `articuloDeTiendaSchema`, `CATALOGO_MCP` |
| `packages/shared/src/mcp-config.ts` | tipos del importador (`ServidorImportado`, `ResultadoImportacion`) |
| `packages/shared/src/argv.ts` · `dependencias.ts` · `servicios.ts` | tipos y reglas puras de comandos, paquetes y servicios |
| `packages/shared/src/programacion.ts` | cálculo puro del próximo disparo (sin esquemas propios) |
| `packages/shared/src/ids.ts` · `nombres.ts` | generador de ids y normalizadores de nombres |
| `packages/shared/src/index.ts` | reexporta todo lo anterior |

El paquete exporta `"."`, `"./schema"` y `"./events"`, todos apuntando a
`src/*.ts`: no hay build. Ver [[Mapa del monorepo]].

## Cómo leer las tablas

- **Default**: un campo con `.default(x)` es **opcional al entrar** y
  **obligatorio al salir** del parse. Por eso `routes.ts` → `registerChild`
  tipa la entrada del esquema como `unknown`: fijar entrada y salida al mismo
  tipo rechazaría los propios esquemas.
- **Nullable**: acepta `null`. Casi todos los nullables del dominio llevan
  además `.default(null)`, así que también pueden faltar.
- **Opcional sin default** (`.optional()`): puede faltar **también a la
  salida**. Se usa a propósito en tres lugares —`Run.foco`, su
  `conversacionId` y los campos `antes`/`commit` de `codigo.checkpoint`— porque
  las filas viejas no los tienen y se leen sin Zod (ver abajo).
- Los rangos `1–200` son de longitud (`min`/`max` de string o de array); en
  números, de valor.

## Dónde se valida y dónde no

Zod es la fuente de verdad **de los tipos**; no todo pasa por un `parse`.

| Punto | Qué parsea | Archivo → símbolo |
|---|---|---|
| Alta y edición genérica | `departmentSchema`, `roleSchema`, `policySchema` | `apps/server/src/routes.ts` → `registerChild` |
| Empresa | `companySchema.partial({id, createdAt, updatedAt})` al crear, `companySchema` al editar | `routes.ts` → `POST /api/companies`, `PATCH /api/companies/:id`; `runtime.ts` → `renombrarEmpresa` |
| Blueprint | `companyBlueprintSchema` | `routes.ts` → `POST /api/companies/import` |
| Misiones y MCP | `misionSchema`, `mcpServerSchema` | `routes.ts`; `runtime.ts` (`migrarLayout`, `instalarServidoresMcp`, reescritura de rutas) |
| Corridas | `createRunSchema`, `injectMessageSchema`, `resolveApprovalSchema` | `routes.ts` → `POST /api/runs`, `/inject`, `/approvals/:approvalId` |
| Código | `origenRepositorioSchema` (vía `cargaSchema`), `argvSchema` (vía `comandosSchema`), `servicioSchema` | `apps/server/src/rutas-codigo.ts` |
| **Lectura de la base** | sólo `repositorioSchema`, `sesionCodigoSchema` y `learningSchema` | `apps/server/src/db.ts` → `listRepositorios`, `getRepositorio`, `listSesionesCodigo`, `getSesionCodigo`, `listLearnings` |

> [!danger] `Store` devuelve JSON crudo: los `.default()` no se aplican al leer
> `Store.one`/`Store.many` hacen `JSON.parse` sin Zod. Una fila guardada antes
> de que existiera un campo vuelve **sin** ese campo, aunque el esquema tenga
> default. Por eso `learnings` se parsea al leer —sin eso el filtro de
> refutadas comparaba contra `undefined`— y por eso `Run.foco` es opcional en
> vez de tener default. Si agregás un campo con default a una entidad que se lee
> cruda (empresa, rol, corrida, tarea…), o migrás las filas, o tratás el
> `undefined` donde se lee, o pasás esa lectura por el esquema.

> [!warning] La traza nunca se parsea
> `traceEventSchema` sólo existe para inferir `TraceEvent`: ni `EventBus.emit`
> ni `Store.listEvents` lo usan. Los topes de un evento (`preview` ≤ 500 en
> `agent.message`, ≤ 2.000 en `tool.end`) son contrato de tipos que respetan los
> emisores, no una validación. Ver [[Referencia de eventos]].

## Primitivos

`packages/shared/src/schema.ts`.

| Esquema | Definición | Para qué |
|---|---|---|
| `idSchema` | string 1–64 | todo id del dominio |
| `timestampSchema` | entero ≥ 0 | milisegundos Unix (`Date.now()`) |
| `providerIdSchema` | `openrouter`/`anthropic`/`openai`/`ollama`/`nvidia`/`claude-sesion`/`claude-code`/`opencode` | coincide con `LlmProvider.id`; un rol elige proveedor **por id** |
| `modelTierSchema` | `free`/`cheap`/`standard`/`smart` | atajo para elegir modelo sin nombrar un slug; se resuelve contra el catálogo vivo |

`claude-sesion`, `claude-code` y `opencode` son ids aparte —y no opciones de
otro proveedor— porque un rol elige proveedor por id: así conviven dos
credenciales del mismo Anthropic, o dos suscripciones, y le das una a un solo
agente. Ver [[Capa LLM y tiers]].

### `modelInfoSchema`

Un modelo tal como lo devuelve el catálogo vivo de un proveedor
(`LlmProvider.listModels`, `GET /api/models`).

| Campo | Tipo | Para qué |
|---|---|---|
| `providerId` | `ProviderId` | de qué proveedor |
| `slug` | string | lo que va en `ModelSelection.modelSlug` |
| `name` | string | etiqueta legible |
| `contextLength` | entero ≥ 0 | ventana de contexto |
| `inputPricePerMTok` · `outputPricePerMTok` | número ≥ 0, nullable | USD por millón de tokens; `null` = el proveedor no publica precio y el costo se cuenta como 0 (`packages/llm/src/ledger.ts` → `computeCost`) |
| `supportsTools` | boolean | si acepta tool-calling |

## Identificadores

`packages/shared/src/ids.ts` → `newId(prefix)`:
`<prefijo>_<Date.now() en base36><6 caracteres base36 al azar>`, por ejemplo
`cmp_msw30yi82fdt1e`. Ordenar por id ordena **aproximadamente por creación**, y
eso hace que feeds y traza salgan en orden sin un índice extra. El azar es
`Math.random`: identifica, no protege nada.

| Generador | Prefijo | Generador | Prefijo |
|---|---|---|---|
| `ids.company` | `cmp` | `ids.task` | `tsk` |
| `ids.department` | `dep` | `ids.artifact` | `art` |
| `ids.role` | `rol` | `ids.approval` | `apv` |
| `ids.tool` | `tol` | `ids.ledger` | `led` |
| `ids.mcpServer` | `mcp` | `ids.learning` | `lrn` |
| `ids.policy` | `pol` | `ids.request` | `req` |
| `ids.mision` | `mis` | `ids.event` | `evt` |
| `ids.run` | `run` | `ids.toolCall` | `call` |
| `ids.message` | `msg` | `ids.repositorio` | `rep` |
| `ids.thread` | `thr` | `ids.sesionCodigo` | `ses` |

Hay ids que no salen de acá: el `callId` de una llamada suele venir del
proveedor, las herramientas propias del CLI usan `cli-<tick>-<vuelta>-<n>` y una
aprobación ejecutada usa `aprobada-<id>` (ver [[Referencia de eventos]]).

## Nombres legibles y técnicos

`packages/shared/src/nombres.ts`. Viven en `@orq/shared` porque los usan dos
árboles —el vault de contexto y las carpetas de proyecto— y con dos copias la
misma empresa terminaba con dos nombres según dónde se mirara.

| Función | Qué hace | Ejemplo |
|---|---|---|
| `segmentoLegible(raw)` | nombre de carpeta **para una persona**: saca separadores de ruta, `:*?"<>\|`, controles y el punto inicial; conserva acentos y espacios; corta en 80 | `INSPIA — Publicidad` queda igual |
| `slugTecnico(raw, fallback)` | nombre para una rama o carpeta técnica: minúsculas, sin acentos, guiones, corta en 60 | `Mi Repo (v2)` → `mi-repo-v2` |

No se reusa `ExportStore.safeSegment` a propósito: ése saca acentos porque sus
nombres viajan en URLs de descarga. Ver [[Directorios en disco]].

## Esquemas locales de la API

Además de los de `@orq/shared`, las rutas definen esquemas para cuerpos que no
son del dominio. Detalle de cada endpoint en [[Referencia de API]] y
[[Referencia de API de código y móvil]].

| Esquema | Archivo | Campos |
|---|---|---|
| `resolveRequestSchema` | `routes.ts` | `decision` (`approve`/`reject`), `resolution` (≤ 8.000, default `""`), `roleProposal` (`RoleProposal`, nullable, para editar la propuesta antes de aceptarla), `comando` (`{ alcance: "siempre"/"una-vez", prefijo?: argv }`, nullable) |
| `learningInput` | `routes.ts` | `topic` (1–120), `lesson` (1–4.000) |
| `learningPatch` | `routes.ts` | parcial de `topic`, `lesson`, `estado`, `motivoDeRefutacion` (1–600); refutar sin motivo es 400 |
| `probeSchema` | `routes.ts` | `toolName` (≥ 1), `args` (record, default `{}`) — el probador del Hub |
| `carpetaSchema` | `routes.ts` | `path` (1–300) — crear carpeta en la salida |
| `purgaSchema` | `routes.ts` | `residuos`, `corridas`, `compactar` (boolean, default `false`), `carpetas` (string[], default `[]`) |
| `cargaSchema` | `rutas-codigo.ts` | `nombre?` (≤ 120), `origen` (`OrigenRepositorio`), `ramaBase?` (≤ 200), `incluirCambiosSinCommitear?` |
| `comandosSchema` | `rutas-codigo.ts` | parcial de `ComandosRepositorio` sin `unaVez` |
| `probarSchema` | `rutas-codigo.ts` | `metodo` (`GET`…`OPTIONS`, default `GET`), `ruta` (1–2.000), `cuerpo?` (≤ 200.000), `cabeceras?` |
| `guardarSchema` | `rutas-codigo.ts` | `ruta` (1–1.000), `contenido`, `hash?` (nullable: `null` = archivo nuevo) |
| inline | `rutas-codigo.ts` | toque `{x,y}` en 0–1, deslizar `{desde, hasta, ms ≤ 5.000}`, tecla (`atras`/`inicio`/`recientes`/`enter`/`borrar`/`menu`), texto (1–300), SQL de lectura (`archivo`, `sql` ≤ 5.000), diagnóstico (`comando` ≤ 300) |

## Tipos que no son Zod

Algunos contratos de `@orq/shared` son interfaces de TypeScript porque no
cruzan una frontera que haya que validar:

| Tipo | Archivo | Nota que lo detalla |
|---|---|---|
| `TraceEventInput` | `events.ts` | [[Referencia de eventos]] |
| `ServidorImportado`, `ResultadoImportacion` | `mcp-config.ts` | [[Esquemas de herramientas y MCP]] |
| `Tokenizado`, `Validacion`, `Decision` | `argv.ts` | [[Esquemas de código y servicios]] |
| `GestorDePaquetes` | `dependencias.ts` | [[Esquemas de código y servicios]] |
| `PaqueteNode`, `CarpetaCandidata`, `Redireccion` | `servicios.ts` | [[Esquemas de código y servicios]] |
| `ComposicionDeTool` | `schema.ts` | [[Esquemas de herramientas y MCP]] |

## Qué fijan los tests

Los de `packages/shared` son puros: no tocan disco ni red.

- `plantillas.test.ts` — las plantillas validan contra su esquema, cierran sus
  referencias internas y sus MCP sugeridos existen. Ver
  [[Referencia de plantillas de equipo]].
- `tienda-mcp.test.ts` — el catálogo valida, no repite ids ni nombres y ningún
  env lleva un valor con pinta de secreto.
- `mcp-config.test.ts` — un secreto literal no se importa y se avisa.
- `argv.test.ts`, `dependencias.test.ts`, `servicios.test.ts` — las reglas de
  comandos, paquetes y servicios.
- `programacion.test.ts` — el próximo disparo es estrictamente posterior y una
  expresión inválida da `null`. Ver [[Misiones programadas]].

## Cómo agregar un campo

1. Agregalo al esquema en `packages/shared/src/schema.ts`, con su comentario
   explicando para qué existe.
2. Decidí **default o opcional** mirando cómo se lee la entidad: si `Store` la
   devuelve cruda, un default no llega a las filas viejas (ver arriba).
3. Si viaja en el blueprint y es una ruta de esta máquina o un secreto, sacalo
   en `GET /api/companies/:id/blueprint` (como `archivosEntorno` y `baseSha`).
4. Si la UI lo edita, el tipo le llega solo por `@orq/shared`.
5. `npm run typecheck` marca los objetos literales que ahora están incompletos
   (seeds, `testing/factory.ts`, `testing/entorno.ts`).

## Fuentes

- `packages/shared/src/schema.ts` — todos los esquemas del dominio
- `packages/shared/src/ids.ts` — `newId`, `ids`
- `packages/shared/src/nombres.ts` — `segmentoLegible`, `slugTecnico`
- `packages/shared/src/index.ts` — reexportaciones
- `apps/server/src/db.ts` — `Store.one`, `Store.many`, lecturas parseadas
- `apps/server/src/routes.ts` — `registerChild`, `invalid`, esquemas locales
- `apps/server/src/rutas-codigo.ts` — `cargaSchema`, `comandosSchema`, `probarSchema`, `guardarSchema`

## Ver también

- [[Modelo de dominio]]
- [[Referencia de eventos]]
- [[Persistencia y esquema SQL]]
- [[ADR-002 Zod como única fuente de verdad]]
- [[Invariantes de arquitectura]]
