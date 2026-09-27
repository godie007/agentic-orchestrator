---
tags: [arquitectura, pantalla]
aliases: [LiveProcess.tsx, LiveProcess, Live Process View, Proceso, Timeline, Cronología, StartRun, Controles de la corrida, Cronologia, armarCronologia]
---

# Pantalla Proceso en vivo

**Ruta:** `/p/:companyId/proceso`. **Componente:**
`apps/web/src/routes/LiveProcess.tsx` → `LiveProcess`.

Cómo trabaja la empresa: el organigrama se anima con la traza, una cronología
cuenta lo que pasa en castellano, y un timeline permite **retroceder y
reproducir** la corrida desde el principio. Desde acá se da un encargo, se
controla la corrida (un ciclo, sin parar, pausar, terminar), se le escribe a
cualquier agente y se resuelven las aprobaciones de herramientas. Ver en vivo y
reproducir son la misma operación: derivar el estado de los eventos hasta un
punto ([[Frontend web]]).

## Dos modos

- **Formulario de encargo** (`StartRun`) cuando la empresa no tiene corridas o
  cuando se apretó **+ encargo**.
- **La corrida**: grilla `grid-cols-[1fr_360px]`. A la izquierda, controles,
  organigrama y timeline; a la derecha, la actividad (o el panel de un agente) y
  la barra lateral.

## Datos

| Fuente | Qué trae | Refresco |
|---|---|---|
| `["runs", companyId]` → `GET /api/runs?companyId=` | la lista del selector | 5 s, también en segundo plano |
| `useRunStream(runId)` → SSE `/api/runs/:id/stream` | la traza (ventana de 5000) | en vivo |
| `["run-events", runId]` → `GET /api/runs/:id/events` | la traza completa | sólo mientras se retrocede |
| `["run", runId]` → `GET /api/runs/:id` | `run` (el `runtime.snapshot`, autoritativo), mensajes, tareas, entregables, aprobaciones, ledger | 3 s, también en segundo plano |
| `["export-tree", companyId]` | archivos, para los enlaces de descarga | 5 s, sólo con la pestaña Entregables abierta |

Al entrar se engancha a la corrida **más reciente**, para no arrancar vacía si ya
hay algo pasando. Si la corrida elegida desaparece de la lista (se limpió), se
suelta y se toma la siguiente: sin eso quedaba en pantalla una corrida fantasma.
Cambiar de corrida en el selector vuelve al vivo.

## Dar un encargo (`StartRun`)

| Campo | Detalle |
|---|---|
| Objetivo | área de texto, precargada con un ejemplo de propuesta comercial. "Entra como un mensaje al rol de mayor autoridad, que lo descompone y delega." |
| Tope de gasto (USD) | número, mínimo 0,05, paso 0,25, por defecto el `budgetUsd` de la empresa. "La corrida se detiene sola al alcanzarlo." |
| Modo | **Manual** (un ciclo por click) o **Continuo** (hasta terminar) |

**Arrancar la empresa** → `POST /api/runs` con `companyId`, `objective`, `mode` y
`budgetUsd`. El servidor completa `maxTicks` con `DEFAULT_MAX_TICKS`
([[Variables de entorno]]), manda el objetivo como mensaje `human` con asunto
"Encargo" al ejecutivo sin jefe (o al primer rol sin jefe) y, en continuo, larga
los ciclos solo. El error se muestra en rojo. Con corridas previas aparece
**volver a la corrida**.

`+ encargo` existe porque antes el formulario sólo aparecía la primera vez:
después el selector listaba las corridas viejas y no había forma de darle un
encargo nuevo.

> [!note] El encargo no está en la cronología
> El mensaje inicial entra por `RunState` sin emitir `agent.message`: se ve en la
> pestaña **Mensajes**, no en "Lo que viene pasando". Un mensaje que escribís
> desde la barra lateral, en cambio, sí emite el evento.

## Barra de controles

Selector de corrida (fecha y 40 caracteres del objetivo), **+ encargo**, el
estado (`Status` con el valor crudo: `running`, `paused`…), "ciclo N" (derivado),
el gasto `US$ total / tope` (en amarillo pasado el 80%), los tokens `↓entrada
↑salida` con `⚡N%` de caché (verde desde 50%; el `title` trae las tres cifras
completas) y el indicador **● en vivo / ○ desconectado** del SSE.

### Los controles se muestran según el estado

Ofrecer "pausar" sobre una corrida terminada, o "continuo" sobre una que ya
corre, obliga a adivinar cuál sirve. `Controles` decide con `esCorridaTerminal`
de `@orq/shared` —antes la lista estaba escrita al revés y metía
`awaiting_approval` entre las terminadas: una corrida que sólo esperaba una
respuesta ofrecía borrarse—.

| Estado | Botones |
|---|---|
| `idle`, `paused`, `awaiting_approval` | **▶ un ciclo** (`POST …/tick`; espera el ciclo entero y queda deshabilitado mientras) · **▶▶ seguir sin parar** (`POST …/resume`, contesta enseguida) |
| `running` | **❚❚ pausar** (`POST …/pause`; frena al cerrar el ciclo en curso, se retoma donde quedó) · **■ terminar** (`POST …/stop`; no se puede retomar) |
| `completed`, `stopped`, `failed`, `budget_exceeded` | "terminada · abrí **+ encargo** para darle trabajo nuevo" · **borrar** |
| cualquiera, con más de una terminada | **limpiar N** |

Cada botón explica en su `title` cuándo conviene. **borrar** y **limpiar N** piden
confirmación en la misma barra ("Los entregables se conservan") y llaman a
`DELETE /api/runs/:id` y `DELETE /api/companies/:id/runs/terminadas`. El servidor
rechaza con 409 borrar una corrida viva o que todavía se puede continuar. Después
de borrar se descarta la caché de esa corrida y se toma la más reciente. Qué es
pausar y qué es terminar: [[Scheduler y ciclo de una corrida]].

Si la corrida tiene `stopReason`, va en un banner amarillo debajo de la barra.
Barra y banner comparten una fila de la grilla a propósito: si el banner fuera
otra fila `auto`, al aparecer colapsaría el organigrama a cero de alto.

## Organigrama

`OrgGraph` dentro de un `Panel`, con el estado derivado, las aristas activas y
los contadores de bandeja (mensajes `pending` del bundle, por destinatario).
Click en un agente abre su panel a la derecha. El componente se documenta en
[[Pantalla Empresa y organigrama]].

Aristas activas: en vivo, las de `recentFlows` (mensajes de los últimos 4 s),
recalculadas con un reloj de 700 ms para que el destello se apague solo aunque no
llegue nada; congelado, las de los mensajes del último ciclo del corte.

## Timeline

Un botón (**● en vivo** o **volver al vivo**), un control deslizante de 0 a la
cantidad de eventos y una etiqueta `corte/total · ciclo N · <evento en
criollo>`. `enCriollo` traduce las 18 variantes de evento a una frase ("arranca
el ciclo", "ejecuta read_artifact", "falló export_pdf", "mensaje: pedido"…): el
`type` crudo es el nombre que le pusimos nosotros, no algo que se pueda leer.

Mover el deslizador fija `scrub` y pide la **traza completa** a la base: el stream
retiene una ventana y el replay tiene que poder ir al principio. Con la traza
cargada, todo lo derivado se recalcula hasta el corte.

> [!warning] Lo que no retrocede
> Siguen mostrando el presente: la barra lateral entera (mensajes, tareas,
> entregables, aprobaciones), las burbujas de bandeja, el estado y el
> `stopReason` de la corrida. Retroceden: organigrama, aristas, cronología,
> panel del agente, ciclo, gasto y tokens.

> [!note] Corridas de más de 5000 eventos
> Mientras llega la traza completa, el deslizador indexa la ventana del stream;
> cuando llega, el mismo índice pasa a contar desde el principio de la corrida y
> el corte salta a otro evento. Soltá y volvé a mover.

## Actividad: "Lo que viene pasando"

Sin agente seleccionado, el panel de arriba a la derecha muestra la
**cronología** de los últimos 400 eventos del corte, **lo último arriba** y con el
autor de cada fila. El panel de un agente usa la misma cronología en orden
cronológico: que las dos se lean igual es la mitad de que se entiendan.

`armarCronologia` agrupa por ciclo y resuelve cada evento a una fila con uno de
tres **niveles** (no todo lo que pasa tiene el mismo peso):

| Nivel | Qué | Eventos |
|---|---|---|
| 0 — la corrida | arranca, se detiene, espera; servidores; aprobaciones | `run.status`, `approval.changed`, `mcp.status` |
| 1 — lo que hace un agente | piensa, escribe, entrega, pide, mueve tareas | `agent.thinking` ("piensa", "sigue pensando · vuelta N" desde la segunda), `agent.message`, `artifact.created` ("entregó X vN"), `task.changed`, `request.created` ("te pide algo"), `log`, `codigo.checkpoint`, `model.selected` sólo si hubo escalado ("el turno corre con …") |
| 2 — con qué lo hizo | cada llamada a herramienta, colgada del agente | `tool.start` + `tool.end` |

Tres decisiones: va **en orden** dentro del ciclo (leer una secuencia de trabajo
al revés no se entiende); **una llamada es una fila**, no dos —la abre
`tool.start` (el punto late mientras no termina) y la completa su `tool.end` con
el resultado, la marca "falló" y la demora si pasó de 1,5 s; si la apertura quedó
fuera de la ventana, el cierre se agrega solo—; y **lo que es contabilidad no es
una fila**: `tick.start`, `tick.end` y `cost.updated` pasan al encabezado del
ciclo ("3 agentes · 5 mensajes · US$0.0123"), y `agent.turn_end` y
`tool.selection` no se dibujan.

En el feed general cada herramienta lleva el **nombre de pila** de quien la
ejecutó: los turnos corren en paralelo y la sangría sola hacía parecer que la
llamada colgaba del agente del renglón de arriba. Los verbos salen de
`accionDeHerramienta` ([[Frontend web]]).

El scroll sigue al presente **sólo si ya lo estabas mirando** (a menos de 40 px
del borde): con varios eventos por segundo, arrastrar la vista en cada uno impide
leer. Con lo más reciente arriba, además se compensa lo que creció el contenido
para que el renglón que leías no se mueva. Vacío: "Todavía no pasó nada. Ejecutá
un ciclo para ver a la empresa trabajar."

## El panel de un agente (`RoleDetail`)

Tres bloques en orden fijo —quién es, con qué cuenta, qué hizo—, con la
cronología llevándose el resto del alto:

- cargo, autoridad, turnos, gasto; tokens de entrada y salida con el porcentaje
  de caché;
- **Herramientas a mano** (plegado): "N de M" expuestas por el router y su motivo
  (`tool.selection`); es lo primero que explica por qué el agente no usó la que
  correspondía ([[Herramientas y tool router]]);
- **Último razonamiento**: el `summary` de su último `agent.turn_end`;
- **Su cronología**: sus últimos 120 eventos.

> [!warning] "Su cronología" no muestra mensajes ni entregables
> Se filtra por el campo `roleId` del evento, y `agent.message`,
> `artifact.created`, `task.changed` y `request.created` no lo tienen (usan
> `fromRoleId`, `authorRoleId`, `assigneeRoleId`, `requestedByRoleId`). Quedan
> sus turnos, herramientas, escalados y logs; lo demás está en el feed general.

## Barra lateral

Cuatro pestañas sobre el bundle REST (la de aprobaciones muestra cuántas hay
pendientes):

| Pestaña | Contenido | Vacío |
|---|---|---|
| mensajes | todos los mensajes, lo último arriba: tipo coloreado, de → a, ciclo, asunto y tres renglones del cuerpo; al pie, el formulario para escribirle a un agente | "Sin mensajes todavía." |
| tareas | título, estado, responsable, prioridad y resultado | "Sin tareas todavía." |
| entregables | título, versión, clave, autor, descargas y "ver contenido" (el markdown en un `<pre>`) | "Sin entregables todavía." |
| aprobaciones | quién pide, estado, motivo; las pendientes con **aprobar** / **rechazar** | "Sin aprobaciones pendientes." |

**Aprobar** llama a `POST /api/runs/:id/approvals/:approvalId`: aprobar **ejecuta
la llamada** con los argumentos que vio la persona y, si era la última pendiente,
la corrida sigue sola ([[Aprobaciones y solicitudes]]). Las solicitudes (rol,
dato, acceso, servidor, comando, dependencia) no están acá: van a
[[Pantalla Solicitudes]].

**Escribirle a un agente** (`InjectMessage`): selector de rol, texto y **enviar**
→ `POST /api/runs/:id/inject` con el asunto "Mensaje de la persona a cargo".
Llega a su bandeja como mensaje `human` y emite `agent.message`, así que aparece
en la cronología como "persona → agente".

> [!warning] Errores que no se muestran
> Los controles de la corrida y el envío de un mensaje no dibujan su error. Con
> una corrida terminada o que no sobrevivió a un reinicio, el servidor contesta
> 409 ("nadie va a leer el mensaje") y en pantalla no pasa nada: el texto queda
> escrito en el campo, que es la única pista.

> [!danger] Los enlaces de descarga ya no aparecen
> `Descargas` busca en la salida archivos que se llamen `<clave>-vN.<ext>`, pero
> las habilidades exportan `<clave>.<ext>` (un archivo por entregable y formato,
> `packages/tools/src/skills/index.ts`). El patrón no coincide y los botones
> "↓ Word / ↓ PDF" sólo salen para exportaciones viejas. Los archivos se bajan
> desde [[Pantalla Salida]].

## Qué fijan los tests

No hay tests de esta pantalla. La derivación que usa la fijan los tests del motor
y de los eventos ([[Pruebas y calidad]]); `apps/server/src/db.test.ts` fija que
borrar una corrida conserva los entregables y se lleva el rastro.

## Fuentes

- `apps/web/src/routes/LiveProcess.tsx` — `LiveProcess`, `StartRun`, `Timeline`,
  `enCriollo`, `Activity`, `RoleDetail`, `armarCronologia`, `Cronologia`,
  `Sidebar`, `InjectMessage`, `Descargas`, `aplanar`, `Controles`.
- `apps/web/src/lib/derive.ts`, `lib/stream.ts`, `lib/acciones.ts`.
- `apps/server/src/routes.ts` — `/api/runs*`.
- `apps/server/src/runtime.ts` — `startRun`, `tick`, `resume`, `pause`, `stop`,
  `inject`.

## Ver también

- [[Pantalla Empresa y organigrama]] — el organigrama por dentro
- [[Pantalla Tablero]] — las mismas tareas, como kanban
- [[Observabilidad y trazas]] y [[Referencia de eventos]]
- [[Supervisión y continuidad]]
- [[Costos y presupuesto]]
