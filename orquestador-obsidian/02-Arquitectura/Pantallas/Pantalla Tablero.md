---
tags: [arquitectura, pantalla]
aliases: [Board.tsx, Board, Kanban, Tablero de tareas, EnCurso, Procesamiento en vivo]
---

# Pantalla Tablero

**Ruta:** `/p/:companyId/tablero`. **Componente:**
`apps/web/src/routes/Board.tsx` → `Board`.

En qué etapa está cada tarea de una corrida y cómo se mueve, más el **trabajo
fino** que ocurre aunque nadie abra una tarea. Las tarjetas se **derivan de la
traza** y no de una consulta: se mueven en el instante en que el agente las mueve.
Lo que no viaja en el evento —prioridad, resultado, el pedido— se completa desde
la corrida, que cambia poco.

## Datos

| Fuente | Qué trae | Refresco |
|---|---|---|
| `["runs", companyId]` | la lista del selector | 5 s, también en segundo plano |
| `useRunStream(runId)` + `derive(events)` | tareas, actividad de cada agente, acciones recientes | en vivo |
| `["run", runId]` | `tasks` con `priority`, `result`, `detail`, `createdByRoleId` | 5 s, también en segundo plano |

Además un reloj propio de 1 s: cuando no llegan eventos no hay nada que dispare
un render, y el destello de una tarjeta que se movió tiene que apagarse solo.

**Qué corrida sigue**: la más reciente al entrar; la siguiente si la elegida se
borró; y —el tablero es para ver moverse el trabajo— si la que tenés enfrente
**terminó** y hay otra `running`, salta a esa. No te saca de una en curso ni de
una pausada. "Terminó" es un conjunto local (`TERMINADAS`: `completed`,
`stopped`, `failed`, `budget_exceeded`), copia de `ESTADOS_TERMINALES` de
`@orq/shared`: hoy coinciden, pero es una segunda lista que puede divergir.

## Encabezado

Selector de corrida (fecha y 60 caracteres del objetivo), el estado derivado de
la traza (`idle` hasta el primer `run.status`) y "ciclo N · M tareas en el
tablero · K canceladas".

## El trabajo fino: `EnCurso`

El tablero sólo mostraba las tareas que los agentes se acuerdan de abrir, y un
encargo puede avanzar veinte pasos sin que aparezca ninguna: quien miraba no
sabía si el sistema trabajaba o estaba trabado. Arriba de las columnas van dos
cajas (no se dibujan si todavía no pasó nada):

- **Agentes · consumo en vivo**: los que ya corrieron o están pensando,
  ordenados por tokens de entrada; avatar con iniciales y tono del área, "·
  <acción>…" si está ejecutando algo, y `↓entrada ↑salida`. Al pie, el total de la
  corrida y "N% del contexto vino de caché". Los tokens son el recurso que de
  verdad se gasta ([[Costos y presupuesto]]).
- **Procesamiento · últimas acciones**: las 14 llamadas a herramienta más
  recientes (de las 120 que retiene `derive`): ciclo, agente, ✓/✕ y la acción en
  castellano; el `title` trae el detalle o el error.

## Las columnas

| Etapa | Pista (`title` de la columna) | Tono |
|---|---|---|
| Pendiente (`pending`) | Asignada, todavía sin arrancar. | `ink-faint` |
| En curso (`in_progress`) | Alguien la está haciendo ahora. | `accent` |
| En revisión (`in_review`) | El trabajo está hecho y espera verificación de Control de Calidad. | `approval` |
| Bloqueada (`blocked`) | Frenada por algo que el asignado no puede resolver solo. | `danger` |
| Hecha (`done`) | Terminada y verificada. | `ok` |

Las **canceladas no tienen columna** —son ruido en un tablero para ver qué se
mueve— y se cuentan en el encabezado. Dentro de cada columna, lo último que se
movió va arriba. El tablero scrollea a lo ancho adentro suyo: con cinco columnas
en una pantalla angosta, empujaba la página entera. Una columna vacía dice "Nada
acá."

## La tarjeta

- Título; avatar con las iniciales del responsable en el tono de su área; su
  nombre; la prioridad si no es `normal` (`urgent` en rojo, `high` en amarillo).
- Si se movió hace menos de **6 s** (`DESTELLO_MS`), borde de acento y "Etapa
  anterior → Etapa actual": sin eso una tarjeta que apareció en Hecha no se
  distingue de una que estuvo ahí siempre.
- `cN` (último ciclo en que se movió) y **dos tiempos que miden cosas distintas**
  (`tiempos`): "⏱ X hasta acá" —cuánto tardó en **llegar** a esta etapa desde que
  se creó, sólo si ya pasó por más de una— y "X acá" —cuánto lleva **parada** acá,
  en rojo si está bloqueada—. Una que tardó 2 minutos en llegar y lleva 40 quieta
  es un problema distinto de una que viene lenta desde el principio. En Hecha o
  cancelada, "cerró en X".
- El resultado, si lo tiene, en dos renglones.

`lapso(ms)`: segundos, minutos o horas con un decimal.

## El detalle de una tarjeta

Click abre una capa (Escape o click afuera la cierran; no es el `Modal` común):

- Encabezado: título, responsable y cargo, "se la pidió X", la prioridad y el
  estado.
- **El pedido** (`task.detail`): el instructivo con el que se pidió el trabajo.
- **Lo que devolvió** (`task.result`).
- **Por dónde pasó**: cada paso de `historia` con su ciclo, cuánto estuvo ahí y la
  hora; arriba, "cerró en X" o "abierta hace X".
- **Qué hizo <nombre>**: las llamadas a herramienta del responsable entre que
  la tarea nació y se cerró, con su resultado. Es lo que no se lee en ningún otro
  lado: si la persona trabajó o el ticket quedó quieto, según lo que ejecutó el
  sistema y no lo que el agente contó. El motor no ata una llamada a una tarea,
  así que se acota por persona y por ventana de tiempo, y la pantalla **lo dice**:
  puede incluir trabajo de otra cosa hecha en paralelo.
- **Lo que se habló**: los mensajes de o para el responsable en la misma ventana.

## Estados vacíos

- Sin corridas: "Todavía no hay ninguna corrida. Dale un encargo desde “Proceso en
  vivo”."
- Sin tareas: "Todavía no hay tareas abiertas. Arriba se ve igual lo que los
  agentes están ejecutando ahora…"

## Casos borde

> [!warning] Una tarea heredada no aparece hasta que alguien la mueve
> Las tareas abiertas de corridas anteriores se **adoptan** al arrancar una nueva
> (`RunState`): se guardan con el `runId` nuevo —la columna `run_id` se actualiza,
> por eso `listTasks` las encuentra en la corrida nueva y no en la vieja— y
> recuerdan su origen en `heredadaDeRunId`. Pero la adopción **no emite
> `task.changed`**, y el tablero sólo dibuja lo que está en la traza: la tarjeta
> aparece recién cuando un agente la actualiza, y aparece como nueva. Mientras
> tanto sí se ve en la pestaña Tareas de [[Pantalla Proceso en vivo]], que lee la
> base. En el tablero de la corrida vieja la tarjeta sigue (su traza no cambió)
> pero pierde prioridad y resultado, porque la fila ya es de otra corrida.
> `heredadaDeRunId` no se muestra en ninguna pantalla. Ver
> [[Supervisión y continuidad]].

- **Sin timeline.** El comentario de `Board.tsx` promete que retroceder muestra el
  tablero de ese ciclo; `derive` sabe hacerlo, pero el tablero siempre deriva la
  traza completa del stream y no tiene control para retroceder.
- **Corridas muy largas.** El tablero usa sólo la ventana de 5000 eventos del
  stream: una tarea cuyo último `task.changed` quedó antes de la ventana
  desaparece de las columnas.

## Qué fijan los tests

No hay tests de la pantalla. `apps/server/src/db.test.ts` fija que una tarea
adoptada se encuentra en la corrida nueva y no en la vieja ("listTasks la
encuentra en la corrida nueva y no en la vieja") y que la lista de trabajo
pendiente deja afuera lo terminado.

## Fuentes

- `apps/web/src/routes/Board.tsx` — `Board`, `ETAPAS`, `DESTELLO_MS`,
  `TERMINADAS`, `Columna`, `Tarjeta`, `tiempos`, `lapso`, `Detalle`, `EnCurso`,
  `miles`.
- `apps/web/src/lib/derive.ts` — `DerivedTask`, `historia`, `acciones`.
- `packages/engine/src/state.ts` — la adopción de tareas.
- `packages/engine/src/loop.ts` → `emitCoordinationEffect` — quién emite
  `task.changed` (`assign_task`, `update_task`).
- `apps/server/src/db.ts` → `upsertRunScoped`.

## Ver también

- [[Pantalla Proceso en vivo]]
- [[Coordinación entre agentes]] — `assign_task` y `update_task`
- [[Estado de una corrida]]
- [[Frontend web]]
