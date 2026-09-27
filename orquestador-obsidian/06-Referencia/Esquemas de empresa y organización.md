---
tags: [referencia, dominio]
aliases: [companySchema, roleSchema, modelSelectionSchema, vozSchema, marcaSchema, departmentSchema, policySchema, misionSchema, programacionSchema, learningSchema, companyBlueprintSchema, authorityLevelSchema, normalizarLeccion, Company, Role, ModelSelection]
---

# Esquemas de empresa y organización

La configuración que definís antes de correr y lo que la empresa recuerda entre
corridas. Todo en `packages/shared/src/schema.ts`. Convenciones de las tablas y
los primitivos: [[Referencia de esquemas]]. Qué significa cada entidad:
[[Modelo de dominio]].

## `modelSelectionSchema` — cómo un rol elige su modelo

Va embebido en `Company.defaultModel` y en `Role.model`. O un tier (se resuelve
al arrancar cada turno), o un slug exacto fijado desde la UI.

| Campo | Tipo | Default | Para qué |
|---|---|---|---|
| `providerId` | `ProviderId` | — (obligatorio) | qué adaptador corre el turno |
| `modelSlug` | string ≥ 1, nullable | `null` | slug exacto (`anthropic/claude-sonnet-5`, `claude-code/opus`). **Tiene prioridad absoluta sobre `tier` y apaga el escalado** |
| `tier` | `ModelTier` | `"standard"` | el tier de reposo del rol |
| `escalado` | objeto, nullable | `null` | escalado por dificultad (abajo) |
| `temperature` | número 0–2, nullable | `null` | `null` = default del proveedor |
| `maxOutputTokens` | entero > 0 | `4096` | tope de salida por llamada |

### `escalado`

| Campo | Tipo | Default | Para qué |
|---|---|---|---|
| `activo` | boolean | `false` | prendido, el motor elige el tier de **cada turno** por dificultad |
| `tierMinimo` | `ModelTier` | `"cheap"` | piso del rango |
| `tierMaximo` | `ModelTier` | `"smart"` | techo del rango |

El default es `null` —y no un objeto apagado— para que las filas viejas, que no
tienen el campo, parseen igual. Quien lo lee es
`packages/engine/src/loop.ts` → `runAgentTurn`: escala sólo si
`escalado?.activo` y **no** hay `modelSlug`; la elección la hace
`packages/engine/src/dificultad.ts` → `elegirTierPorDificultad`. Ver
[[Escalado por dificultad]].

Quién lo arma ya prendido:

| Origen del rol | Rango | Dónde |
|---|---|---|
| Plantilla de equipo | el de la plantilla (`tier` = `tierMinimo`) | `apps/server/src/runtime.ts` → `generarEquipo` |
| Solicitud `create_role` aprobada | executive `standard..smart`; resto `cheap..standard`; empresa en `free` → `free..free` | `runtime.ts` → `conEscaladoPorAutoridad` |
| Especialista convocado | `cheap..standard` (nace executor); empresa en `free` → `free..free` | `packages/engine/src/state.ts` → `RunState.incorporarRol` (copia la regla: el motor no puede importar del servidor) |
| Proyecto creado desde la UI | `defaultModel` con `cheap..smart`, tier `standard` | `apps/web/src/routes/Proyectos.tsx` |

## `vozSchema` — cómo suena la marca

Vive en la empresa y no en el guion: el nombre se pronuncia igual en todos sus
videos, y "codishon" escrito en el guion sería una falta de ortografía en
pantalla.

| Campo | Tipo | Default | Para qué |
|---|---|---|---|
| `unaSolaVoz` | boolean | `false` | todos los personajes con la misma voz: habla la empresa, no un elenco |
| `pronunciacion` | `Record<string,string>` | `{}` | lo escrito → cómo se dice. Se aplica **sólo al texto que va al sintetizador** y compara por palabra entera, sin acentuar |

Lo consumen `export_video`, `export_video_estudio` y `export_video_clips`
(`packages/tools/src/skills/index.ts`). Ver [[Voz y marca de la empresa]].

## `marcaSchema` — cómo se ve la marca

| Campo | Tipo | Default | Para qué |
|---|---|---|---|
| `acento` | string `#rrggbb` | `"#40a0f8"` | color de realce: barras, subrayados |
| `panel` | string `#rrggbb` | `"#232f4d"` | fondo de paneles y rótulos con texto claro |
| `rotulos` | boolean | `false` | escribir el título de cada escena sobre el video. Apagado porque una app filmada ya trae sus propios títulos y el rótulo compite |

La regex rechaza cualquier otro formato de color con el mensaje "un color en
formato #rrggbb". Hoy lo lee `export_video_clips`.

## `companySchema`

| Campo | Tipo | Default | Para qué |
|---|---|---|---|
| `id` | `idSchema` | — | `cmp_…` |
| `name` | string 1–200 | — | nombre; renombrar mueve carpeta y vault (`Runtime.renombrarEmpresa`) |
| `mission` | string ≤ 4.000 | `""` | va al prompt como "Misión de la empresa" (`packages/engine/src/prompt.ts` → `buildSystemPrompt`) |
| `voz` | `Voz` | `{unaSolaVoz: false, pronunciacion: {}}` | ver arriba |
| `marca` | `Marca` | `{acento, panel}` + `rotulos: false` por el default interno | ver arriba |
| `context` | string ≤ 20.000 | `""` | "Contexto de negocio" que reciben **todos** los agentes en su prompt |
| `currency` | string de largo 3 | `"USD"` | metadato; hoy ningún componente lo lee |
| `budgetUsd` | número > 0 | `1` | tope de gasto **por corrida**, si el pedido no trae otro (`Runtime.startRun`: `input.budgetUsd ?? company.budgetUsd ?? DEFAULT_RUN_BUDGET_USD`) |
| `defaultModel` | `ModelSelection` | — (obligatorio) | lo heredan los roles nuevos del diseñador, los convocados y los aprobados |
| `createdAt` · `updatedAt` | timestamp | — | |

> [!warning] Una empresa vieja puede no tener `marca`
> `Store.getCompany` devuelve el JSON crudo. Una fila guardada antes de que
> existiera `marca` vuelve sin el campo hasta que alguien la edita (el `PATCH`
> sí parsea). Es la trampa general descripta en [[Referencia de esquemas]].

## `departmentSchema`

| Campo | Tipo | Default | Para qué |
|---|---|---|---|
| `id`, `companyId` | `idSchema` | — | |
| `name` | string 1–200 | — | se busca por nombre (sin mayúsculas) al generar equipos y convocar |
| `purpose` | string ≤ 4.000 | `""` | |
| `parentId` | id, nullable | `null` | área padre; `null` = reporta a la empresa. Hoy sólo se remapea al importar un blueprint: la jerarquía que se dibuja sale de `Role.reportsTo` |
| `position` | `{x, y}` | `{0,0}` | sólo presentación en el canvas |

## `authorityLevelSchema`

`executor` (ejecuta, escala cualquier decisión) · `manager` (decide dentro de su
área) · `executive` (decide para toda la empresa). No es decorativo: la
autoridad la mira el ejecutor de varias herramientas —convocar
(`executive`), crear herramientas y repos (`manager`/`executive`), borrar en la
salida (`puedeBorrar`)— y el medidor de dificultad. Ver
[[Organización de agentes]].

## `roleSchema` — un rol es un agente

| Campo | Tipo | Default | Para qué |
|---|---|---|---|
| `id`, `companyId`, `departmentId` | `idSchema` | — | |
| `name` · `title` | string 1–200 | — | los agentes se nombran **por nombre** en las herramientas, no por id |
| `systemPrompt` | string ≤ 20.000 | `""` | instrucciones propias; se compone con misión, contexto, políticas y memoria. Se guarda al crear: un cambio en una plantilla o preset no llega a un rol ya creado |
| `model` | `ModelSelection` | — | |
| `toolIds` | id[] | `[]` | herramientas `capability`, `skill`, `mcp` y `creada` asignadas. **No** controla las de coordinación, que se otorgan siempre (`ToolRegistry.forRole`) |
| `authority` | `AuthorityLevel` | `"executor"` | |
| `reportsTo` | id, nullable | `null` | a quién escala; `null` = tope de la jerarquía |
| `maxTurns` | entero 1–50 | `8` | **base** del presupuesto de iteraciones de un turno, no un techo fijo (abajo) |
| `spendApprovalThresholdUsd` | número ≥ 0, nullable | `null` | monto a partir del cual debe pedir aprobación |
| `position` | `{x, y}` | `{0,0}` | canvas; los repetidos los acomoda `OrgGraph.autoLayout` |

`maxTurns` entra en `packages/engine/src/loop.ts` →
`presupuestoDeIteraciones`: base = `max(3, round((maxTurns + 2·mensajes +
tareas + min(6, ⌊caracteres/4000⌋)) × escala))` con escala 0,5 al retomar un
turno cortado; techo = `min(50, 2·base)`, alcanzable sólo mientras el agente
siga avanzando. Ver [[Motor de agentes]].

> [!warning] `spendApprovalThresholdUsd` es texto, no un freno
> Sólo se agrega al prompt ("cualquier compromiso económico por encima de
> US$X…", `prompt.ts`). Ningún ejecutor lo compara con nada.

## `policySchema`

| Campo | Tipo | Default | Para qué |
|---|---|---|---|
| `id`, `companyId` | `idSchema` | — | |
| `name` | string 1–200 | — | |
| `statement` | string 1–4.000 | — | lo que leen los agentes: va al prompt como `- nombre: statement` |
| `appliesToRoleIds` | id[] | `[]` | roles alcanzados; vacío = toda la empresa |
| `gate` | `{type: "spend_above", amountUsd ≥ 0, requiresRoleId}`, nullable | `null` | ver abajo |

> [!danger] `gate` no se evalúa en ningún lado
> El comentario del esquema dice que "se evalúa en código antes de dejar pasar
> una acción", pero ni el motor ni las herramientas leen `policy.gate`
> (verificado con `grep` sobre `packages/` y `apps/`), y la UI no lo edita. Hoy
> una política es sólo su `statement` en el prompt. Un freno de gasto real
> tendría que vivir en el ejecutor, como `requiresApproval`.

## `programacionSchema` — cuándo se dispara una misión

Unión discriminada por `type`: las tres formas del nodo Schedule de n8n.

| `type` | Campos | Restricciones |
|---|---|---|
| `intervalo` | `cada`, `unidad` | `cada` entero > 0; `unidad` `minutos`/`horas`/`dias`/`semanas` |
| `semanal` | `dias`, `hora`, `minuto` | `dias` enteros 0–6 (0 = domingo), **mínimo uno** (vacío nunca dispararía); `hora` 0–23; `minuto` 0–59, default `0` |
| `cron` | `expresion` | string 1–200: cinco campos (minuto hora día-del-mes mes día-de-semana) |

Se resuelve en la hora local del servidor con
`packages/shared/src/programacion.ts` → `proximaCorrida` (estrictamente
posterior a `desde`; `null` si la expresión no se entiende) y se describe con
`describirProgramacion`. Ver [[Misiones programadas]].

## `misionSchema`

La receta de una corrida más cuándo repetirla. Se guarda a nivel empresa y
sobrevive a los reinicios.

| Campo | Tipo | Default | Para qué |
|---|---|---|---|
| `id`, `companyId` | `idSchema` | — | |
| `name` | string 1–200 | — | |
| `objective` | string 1–8.000 | — | el encargo, tal como lo daría una persona |
| `programacion` | `Programacion` | — | |
| `enabled` | boolean | `true` | |
| `budgetUsd` | número > 0 | `1` | presupuesto de cada corrida que larga |
| `maxTicks` | entero > 0, nullable | `null` | `null` = el default del servidor |
| `avisarA` | email[] | `[]` | a quién avisa por correo al terminar (webhook de n8n) |
| `proximaAt` | timestamp, nullable | `null` | próximo disparo **guardado en la base**, no en un timer; `null` = pausada o sin calcular |
| `ultimaAt` · `ultimaRunId` | nullable | `null` | último disparo |
| `createdAt` · `updatedAt` | timestamp | — | |

## `learningSchema` — memoria de la empresa

Vive a nivel **empresa** y sobrevive a la corrida que la produjo. Es un reclamo
que requiere evidencia, no un hecho a guardar.

| Campo | Tipo | Default | Para qué |
|---|---|---|---|
| `id`, `companyId` | `idSchema` | — | |
| `topic` | string 1–120 | — | agrupador: `precios`, `cliente:retail`; también es la nota del vault |
| `lesson` | string 1–4.000 | — | autocontenida y accionable |
| `authorRoleId` | id, nullable | `null` | `null` = la cargó una persona |
| `runId` | id, nullable | `null` | corrida donde se aprendió |
| `timesConfirmed` | entero > 0 | `1` | sube sólo con una confirmación **independiente** (otro autor u otra corrida) |
| `evidencia` | string ≤ 600, nullable | `null` | herramienta y resultado que la respaldan; `record_lesson` la exige (`evidence`) |
| `estado` | `activa`/`cuestionada`/`refutada` | `"activa"` | `refutada` deja de entrar al prompt pero **no se borra**; `cuestionada` entra marcada |
| `refutacion` | `{motivo 1–600, at}`, nullable | `null` | el tombstone; sólo lo pone una persona (`PATCH …/learnings/:id` exige motivo) |
| `confirmaciones` | `{roleId, runId, at}[]`, máx. 20 | `[]` | quién la reafirmó de verdad |
| `createdAt` · `updatedAt` | timestamp | — | |

Es la única entidad del núcleo que `Store.listLearnings` **parsea al leer**:
sin eso, las filas anteriores a `estado` compararían contra `undefined` y una
refutada volvería al prompt.

`normalizarLeccion(text)` —minúsculas, sin acentos, sin signos, espacios
colapsados— vive en `@orq/shared` porque la memoria entra por dos puertas
(`record_lesson` y `POST /api/companies/:id/learnings`) y con dos copias lo que
una consideraba repetido la otra lo creaba de nuevo. La confirmación
independiente la decide `packages/engine/src/state.ts` →
`RunState.recordLesson`. Ver [[Memoria de la empresa]].

## `companyBlueprintSchema` — la empresa entera como JSON

| Campo | Tipo | Default | Para qué |
|---|---|---|---|
| `version` | literal `1` | — | versión del formato |
| `company` | `Company` | — | |
| `departments` · `roles` · `policies` · `mcpServers` | arrays | — | |
| `tools` | `Tool[]` | — | todo lo que no es `mcp` (las MCP se redescubren al conectar); incluye las `creada` |
| `repositorios` | `Repositorio[]` | `[]` | sólo los de origen `git`, **sin rutas locales** |

Reglas de `GET /api/companies/:id/blueprint` y `POST /api/companies/import`
(`apps/server/src/routes.ts`):

- Al exportar, a cada repo se le vacían `baseSha`, `comandos.unaVez` y los
  `archivosEntorno` de sus servicios: son de esta máquina o de una sesión.
- Al importar se **reasignan todos los ids** (empresa, áreas, roles, tools,
  políticas, servidores) con un mapa que mantiene coherentes `parentId`,
  `departmentId`, `reportsTo`, `toolIds` y `appliesToRoleIds`. Así se puede
  importar dos veces la misma empresa sin pisar la original.
- Los repos se vuelven a clonar en segundo plano y llegan con
  `pendienteDeConfirmar: true`: importar un JSON no puede autorizar comandos.
- Los secretos no viajan porque nunca se guardaron: los MCP guardan
  **referencias** a variables de entorno.

> [!note] Lo que el import no remapea
> `McpServer.otorgarAlConectar` y `Tool.composicion.creadaPorRoleId` quedan con
> los ids viejos. El primero apunta a roles que no existen en la copia, así que
> esas tools no se otorgan solas al conectar.

## Plantillas de equipo

`plantillaRolSchema` y `plantillaEquipoSchema` (`packages/shared/src/plantillas.ts`)
describen organigramas listos para materializar. Campo por campo en
[[Referencia de plantillas de equipo]].

## Fuentes

- `packages/shared/src/schema.ts` — `modelSelectionSchema`, `vozSchema`, `marcaSchema`, `companySchema`, `departmentSchema`, `authorityLevelSchema`, `roleSchema`, `policySchema`, `programacionSchema`, `misionSchema`, `learningSchema`, `normalizarLeccion`, `companyBlueprintSchema`
- `packages/shared/src/programacion.ts` — `proximaCorrida`, `parseCron`, `describirProgramacion`
- `packages/engine/src/loop.ts` — `runAgentTurn`, `presupuestoDeIteraciones`
- `packages/engine/src/prompt.ts` — `buildSystemPrompt`
- `packages/engine/src/state.ts` — `RunState.incorporarRol`, `RunState.recordLesson`
- `apps/server/src/runtime.ts` — `conEscaladoPorAutoridad`, `generarEquipo`, `startRun`
- `apps/server/src/routes.ts` — blueprint, learnings

## Ver también

- [[Referencia de esquemas]]
- [[Esquemas de corrida y trabajo]]
- [[Modelo de dominio]]
- [[Organización de agentes]]
- [[Memoria de la empresa]]
- [[Misiones programadas]]
