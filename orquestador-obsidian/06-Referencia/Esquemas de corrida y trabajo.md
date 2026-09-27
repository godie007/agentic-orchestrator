---
tags: [referencia, dominio]
aliases: [runSchema, esCorridaTerminal, ESTADOS_TERMINALES, messageSchema, taskSchema, artifactSchema, approvalRequestSchema, agentRequestSchema, agentRequestTypeSchema, roleProposalSchema, servidorMcpPropuestoSchema, ledgerEntrySchema, createRunSchema, injectMessageSchema, resolveApprovalSchema, Run, Message, Task, Artifact, AgentRequest]
---

# Esquemas de corrida y trabajo

Lo que existe mientras una empresa trabaja: la corrida, sus mensajes, tareas,
entregables, aprobaciones, solicitudes a la persona y el gasto. Todo en
`packages/shared/src/schema.ts`. Convenciones: [[Referencia de esquemas]]. El
ciclo de vida de una corrida está dibujado en [[Modelo de dominio]].

## `runStatusSchema` y `esCorridaTerminal`

`idle` · `running` · `paused` · `awaiting_approval` · `completed` · `stopped` ·
`budget_exceeded` · `failed`.

`ESTADOS_TERMINALES = ["completed", "stopped", "budget_exceeded", "failed"]` y
`esCorridaTerminal(status)` viven en `@orq/shared` porque la pregunta "¿esto se
puede continuar?" se hace en tres lados —el scheduler para cortar el bucle, el
servidor para no borrar trabajo vivo, la UI para decidir qué botón ofrecer— y
cada copia se desincronizó: la UI trataba `awaiting_approval` como terminada y
ofrecía **borrar** una corrida que sólo esperaba una respuesta.

| Consumidor | Dónde |
|---|---|
| scheduler | `packages/engine/src/scheduler.ts` → `isTerminal` (envuelve `esCorridaTerminal`) |
| UI | `apps/web/src/routes/LiveProcess.tsx`, `routes/codigo/Chat.tsx` |

> [!warning] Quedan tres copias literales de la lista
> `apps/server/src/misiones.ts` (`terminales`), `apps/server/src/runtime.ts` →
> `inject` y `apps/web/src/routes/Board.tsx` (`TERMINADAS`) escriben
> `["completed","stopped","failed","budget_exceeded"]` a mano. Hoy coinciden;
> si se agrega un estado terminal hay que tocarlas o, mejor, reemplazarlas por
> `esCorridaTerminal`.

`runModeSchema`: `manual` (un ciclo por pedido), `continuous` (hasta terminar,
`Orchestrator.runContinuous`), `cron` (un ciclo cada `cronIntervalMs`,
`Orchestrator.startCron`). La UI ofrece sólo manual y continuo; misiones y chat
del IDE usan `continuous`. `cron` queda accesible por la API.

## `runSchema`

| Campo | Tipo | Default | Para qué |
|---|---|---|---|
| `id`, `companyId` | `idSchema` | — | |
| `objective` | string 1–8.000 | — | el encargo; es lo que se lista en la UI |
| `status` | `RunStatus` | `"idle"` | el autoritativo es `Orchestrator.snapshot`, no la fila (ver [[Trampas conocidas]]) |
| `mode` | `RunMode` | `"manual"` | |
| `tick` | entero ≥ 0 | `0` | ciclo actual |
| `maxTicks` | entero > 0 | `50` | tope de ciclos; alcanzarlo cierra como `completed` |
| `budgetUsd` | número > 0 | — (obligatorio) | tope de gasto; el ledger corta al superarlo |
| `spentUsd` | número ≥ 0 | `0` | |
| `cronIntervalMs` | entero > 0 | `60000` | sólo modo cron |
| `stopReason` | string, nullable | `null` | por qué se detuvo; la UI lo muestra |
| `startedAt` | timestamp | — | |
| `endedAt` | timestamp, nullable | `null` | lo fija `Orchestrator.finish` |
| `foco` | objeto, nullable, **opcional** | ausente | corrida enfocada del chat del IDE (abajo) |

### `foco`

| Campo | Tipo | Para qué |
|---|---|---|
| `rolId` | id | el único agente de la corrida: el organigrama se reduce a él y no adopta tareas ajenas |
| `repoId` | id | repo principal del turno (`abrirTurnoDeCodigo` → `repoPrincipalId`) |
| `conversacionId` | string ≤ 60, opcional | conversación del chat a la que pertenece el pedido |

Es opcional y no `.default()` porque las filas viejas no lo tienen y se leen sin
Zod. Con foco, `Runtime.startRun` usa `maxTicks = 4` si el pedido no trae otro,
y el scheduler cierra como `completed` en cuanto el agente respondió sin nada
pendiente. Ver [[Chat de IA]].

## `messageSchema`

| Campo | Tipo | Default | Para qué |
|---|---|---|---|
| `id`, `runId` | `idSchema` | — | |
| `fromRoleId` | id, nullable | — | `null` = la persona (o el sistema) |
| `toRoleId` | id, nullable | — | `null` con `broadcast` |
| `toDepartmentId` | id, nullable | `null` | destino de un broadcast: se expande a la bandeja de cada integrante |
| `type` | `MessageType` | — | abajo |
| `subject` | string ≤ 300 | `""` | |
| `body` | string ≤ 50.000 | — | |
| `threadId` | id | — | agrupa la conversación; un mensaje nuevo abre hilo (`thr_…`) |
| `inReplyTo` | id, nullable | `null` | responder marca el original como `answered` |
| `status` | `MessageStatus` | `"pending"` | abajo |
| `tick` | entero ≥ 0 | — | ciclo en que se envió |
| `createdAt` | timestamp | — | |

`messageTypeSchema`: `request` (espera respuesta) · `response` · `report` (sin
respuesta esperada) · `escalation` · `approval_request` · `approval_grant` ·
`approval_deny` · `broadcast` · `human` (la persona desde la UI, el encargo
inicial y los avisos del sistema). `approval_request` existe en el enum pero
nadie envía ese tipo: una aprobación se pide con `ApprovalRequest`.

`messageStatusSchema`: `pending` · `delivered` · `read` · `answered`. En el
código real un mensaje va **`pending` → `read`** (`RunState.drainInbox`) →
**`answered`** (`RunState.sendMessage` con `inReplyTo`). `delivered` no lo fija
nadie.

## `taskSchema`

| Campo | Tipo | Default | Para qué |
|---|---|---|---|
| `id`, `runId` | `idSchema` | — | `runId` cambia cuando otra corrida la adopta (`Store.upsertRunScoped` actualiza también la columna) |
| `title` | string 1–300 | — | |
| `detail` | string ≤ 10.000 | `""` | el instructivo con que se pidió |
| `assigneeRoleId` | id | — | |
| `createdByRoleId` | id, nullable | — | |
| `status` | `TaskStatus` | `"pending"` | abajo |
| `priority` | `low`/`normal`/`high`/`urgent` | `"normal"` | |
| `dueTick` | entero ≥ 0, nullable | `null` | ciclo en que debería estar |
| `result` | string ≤ 20.000, nullable | `null` | |
| `heredadaDeRunId` | id, nullable | `null` | corrida donde se abrió, si viene de una anterior |
| `createdAt` · `updatedAt` | timestamp | — | |

`taskStatusSchema`: `pending` · `in_progress` · `in_review` · `blocked` ·
`done` · `cancelled` (el orden del tablero). `in_review` existe para que el
paso por control de calidad sea una etapa visible. `done` y `cancelled` no se
heredan entre corridas (`Store.listTasksAbiertasByCompany`). Ver
[[Supervisión y continuidad]].

## `artifactSchema`

| Campo | Tipo | Default | Para qué |
|---|---|---|---|
| `id`, `runId` | `idSchema` | — | además la tabla guarda `company_id`: el entregable sobrevive a su corrida |
| `key` | string 1–200 | — | identidad lógica; se versiona la misma clave |
| `title` | string 1–300 | — | `write_artifact` rechaza títulos de proceso ("Ciclo 2") |
| `contentType` | `markdown`/`json`/`text` | `"markdown"` | |
| `content` | string ≤ 500.000 | — | |
| `version` | entero > 0 | `1` | |
| `authorRoleId` | id | — | |
| `tick` | entero ≥ 0 | — | |
| `createdAt` | timestamp | — | no hay `updatedAt`: "el último" se ordena por `version` y después `createdAt` |

Ver [[Entregables]].

## `approvalRequestSchema`

Dejar pasar una acción bloqueada. Alcance: la corrida.

| Campo | Tipo | Default | Para qué |
|---|---|---|---|
| `id`, `runId` | `idSchema` | — | |
| `requestedByRoleId` | id | — | |
| `approverRoleId` | id, nullable | — | se completa con el `reportsTo` del solicitante; `null` = la persona |
| `reason` | string ≤ 4.000 | — | |
| `toolName` | string, nullable | `null` | herramienta bloqueada, si la hay |
| `toolArgs` | record, nullable | `null` | argumentos **que ve la persona y con los que se ejecuta** al aprobar |
| `status` | `pending`/`granted`/`denied`/`expired` | `"pending"` | `expired` no lo fija nadie hoy |
| `resolution` | string ≤ 4.000, nullable | `null` | |
| `createdAt` · `resolvedAt` | timestamp | — / `null` | |

La abren una herramienta con `requiresApproval` (`loop.ts` → `executeOne`) o
`request_approval`. Aunque exista `approverRoleId`, **ninguna herramienta de
agente resuelve aprobaciones**: las resuelve una persona por
`POST /api/runs/:id/approvals/:approvalId`, y aprobar ejecuta la llamada
(`Orchestrator.ejecutarAprobada`). Ver [[Aprobaciones y solicitudes]].

## `agentRequestSchema` — lo que un agente le pide a la persona

Alcance: la **empresa** (sobrevive a la corrida y se hereda).

| Campo | Tipo | Default | Para qué |
|---|---|---|---|
| `id`, `companyId` | `idSchema` | — | |
| `runId` | id, nullable | `null` | corrida que la abrió |
| `requestedByRoleId` | id, nullable | — | |
| `type` | `AgentRequestType` | — | abajo |
| `reason` | string 1–4.000 | — | lo que la persona lee para decidir |
| `roleProposal` | `RoleProposal`, nullable | `null` | tipo `create_role` |
| `question` | string ≤ 4.000, nullable | `null` | tipo `context` |
| `toolNames` | string[] | `[]` | tipo `tool_access` |
| `mcpProposal` | `ServidorMcpPropuesto[]` | `[]` | tipo `mcp_server`, ya sin secretos |
| `comando` | `{repoId, argv (1–40 × 1–400)}`, nullable | `null` | tipo `comando` |
| `dependencia` | objeto, nullable | `null` | tipo `dependencia` (abajo) |
| `status` | `pending`/`approved`/`rejected` | `"pending"` | |
| `resolution` | string ≤ 8.000, nullable | `null` | la respuesta o el motivo del rechazo |
| `createdAt` · `resolvedAt` | timestamp | — / `null` | |

`agentRequestTypeSchema` y quién crea cada tipo:

| Tipo | Herramienta | Aprobarla… |
|---|---|---|
| `create_role` | `request_new_role` | crea el rol (con `conEscaladoPorAutoridad`) |
| `context` | `request_context` | le lleva la respuesta al agente |
| `tool_access` | `request_tool_access` | asigna las herramientas |
| `mcp_server` | `solicitar_servidor_mcp` | instala, conecta y otorga al solicitante |
| `comando` | `solicitar_comando` | permite el argv una vez o siempre (`resolveRequestSchema.comando`) |
| `dependencia` | `instalar_dependencia` | instala en la sesión del repo; si falla, la solicitud queda pendiente |

El enum lo reusa `events.ts` (`request.created`): copiado a mano, un tipo nuevo
parseaba en la base y rompía el evento que lo anunciaba.

### `dependencia`

`repoId` · `gestor` (`npm`/`pnpm`/`yarn`) · `paquetes` (1–10 strings de 1–260)
· `dev` (default `false`) · `carpeta` (≤ 300, default `""`: subcarpeta del
monorepo). Se valida en la herramienta **y otra vez al aprobar** con
`validarPaquete`. Ver [[Instalación de dependencias]].

### `roleProposalSchema`

`name`, `title` (1–200) · `departmentName` (1–200; si no existe se crea al
aceptar) · `systemPrompt` (≤ 20.000, `""`) · `authority` (`"executor"`) ·
`reportsToName` (≤ 200, nullable, `null` = a quien lo propuso). La persona la
puede editar antes de aceptar.

### `servidorMcpPropuestoSchema`

`name` (1–64, `^[a-z0-9_-]+$`) · `description` (≤ 1.000, `""`) · `transport`
(`McpTransport`). Llega ya saneada por `parsearConfigMcp`: aprobarla nunca puede
escribir una credencial. Ver [[Esquemas de herramientas y MCP]].

## `ledgerEntrySchema`

Una fila por llamada al modelo.

| Campo | Tipo | Default | Para qué |
|---|---|---|---|
| `id`, `runId` | `idSchema` | — | |
| `roleId` | id, nullable | — | `null` = el sistema |
| `providerId` | `ProviderId` | — | |
| `modelSlug` | string | — | el modelo que **respondió** (con fallback puede no ser el pedido) |
| `tick` | entero ≥ 0 | — | |
| `inputTokens` · `outputTokens` | entero ≥ 0 | — | |
| `cachedInputTokens` | entero ≥ 0 | `0` | de los de entrada, los servidos desde caché |
| `costUsd` | número ≥ 0 | — | el informado por el proveedor si lo informa; si no, estimado con el catálogo |
| `latencyMs` | número ≥ 0 | — | |
| `createdAt` | timestamp | — | |

Lo escribe el callback de `RunLedger` en `Runtime.startRun`. Ver
[[Costos y presupuesto]].

## Payloads de corrida

| Esquema | Campos |
|---|---|
| `createRunSchema` | `companyId` · `objective` (1–8.000) · `mode` (`"manual"`) · `maxTicks?` (≤ 500) · `budgetUsd?` (> 0, ≤ 1.000) · `cronIntervalMs?` (≥ 1.000) · `foco?` `{rolId, repoId, contexto (≤ 40.000, default ""), conversacionId? (regex ^[a-z0-9_-]{4,60}$, sin distinguir mayúsculas)}` |
| `injectMessageSchema` | `toRoleId` · `subject` (≤ 300, `""`) · `body` (1–50.000) |
| `resolveApprovalSchema` | `decision` (`grant`/`deny`) · `resolution` (≤ 4.000, `""`) |

`foco.contexto` es lo que adjuntó la persona (archivos con `@`, la selección del
editor): viaja en el mensaje al agente y no en `objective`, que tiene su propio
tope y es lo que se lista. Los pedidos anteriores de la misma conversación los
arma `Runtime.historiaDeConversacion` leyendo el `agent.turn_end` de cada corrida
previa (presupuesto de 8.000 caracteres, hasta 8 pedidos).

## Fuentes

- `packages/shared/src/schema.ts` — todos los esquemas de esta nota, `ESTADOS_TERMINALES`, `esCorridaTerminal`
- `packages/engine/src/scheduler.ts` — `Orchestrator`, `isTerminal`, `resolveApproval`, `ejecutarAprobada`
- `packages/engine/src/state.ts` — `sendMessage`, `drainInbox`, `createTask`
- `apps/server/src/runtime.ts` — `startRun`, `inject`, `historiaDeConversacion`
- `apps/server/src/db.ts` — `listTasksAbiertasByCompany`, `upsertRunScoped`

## Ver también

- [[Referencia de esquemas]]
- [[Modelo de dominio]]
- [[Scheduler y ciclo de una corrida]]
- [[Estado de una corrida]]
- [[Aprobaciones y solicitudes]]
- [[Referencia de eventos]]
