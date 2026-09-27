---
tags: [arquitectura, pantalla]
aliases: [Memory.tsx, Memory, EditorDeLeccion, Pantalla de memoria, Refutar desde la UI]
---

# Pantalla Memoria

**Ruta:** `/p/:companyId/memoria`. **Componente:**
`apps/web/src/routes/Memory.tsx` → `Memory`.

Lo que la empresa aprendió entre corridas. Es lo que evita volver a pagar por
conocimiento que la empresa ya tiene: las lecciones activas entran en el prompt de
cada agente. Acá se leen, se **siembran** a mano —sembrar la memoria antes de la
primera corrida es la forma más barata de que la empresa arranque sabiendo algo—,
se corrigen y, sobre todo, se **refutan**. La memoria por dentro (evidencia,
confirmaciones, el espejo al vault): [[Memoria de la empresa]].

## Datos

`["learnings", companyId]` → `GET /api/companies/:id/learnings` cada **5 s**. El
servidor ordena por `timesConfirmed` y después por `updatedAt`; la pantalla agrupa
por `topic` en ese orden.

## Lo que la empresa aprendió (N)

La leyenda dice "entra en el prompt de todos los agentes" (las refutadas no). Por
tema, un encabezado y sus lecciones:

- El texto. **Refutada**: tachado y apagado, con "Refutada: <motivo>" en rojo.
  **Cuestionada**: precedida por "(?)" en amarillo ("Sin verificar").
- "Evidencia: …" en cursiva, salvo en las refutadas. Una lección cargada a mano
  trae "cargada a mano por la persona a cargo": la procedencia es la persona.
- Autor (el agente, o "cargada a mano"), "reafirmada ×N" si se confirmó más de una
  vez, y la fecha de la última actualización.
- Al pasar el mouse: **editar** (abre el editor) y **olvidar**.

Vacío: "La memoria está vacía. Los agentes la llenan con `record_lesson` durante
una corrida, o podés sembrarla vos acá al costado."

> [!warning] "olvidar" borra sin preguntar
> Es un `DELETE` inmediato y sin papelera; también saca la lección de la nota del
> vault. Para marcar una lección falsa sin perder el registro, el camino es
> **editar → refutar**: su `title` lo dice.

## Enseñarle algo

| Campo | Pista |
|---|---|
| Tema | "Agrupador corto: precios, estimación, cliente:retail…" |
| Lección | "Autocontenida: alguien que no vio ninguna corrida tiene que poder aplicarla." |

**guardar** (con los dos campos) → `POST /api/companies/:id/learnings`. Si ya
existe la misma lección —misma regla de normalización que `record_lesson`, en
`@orq/shared` → `normalizarLeccion`—, no se crea otra: se **confirma** la
existente (sube "reafirmada") y el servidor contesta 200 en vez de 201. En los dos
casos la nota del tema se reescribe en el vault ([[Vault de contexto]]).

## Editar, refutar, restaurar (`EditorDeLeccion`)

Un `Modal` "Editar lección — <tema>" con:

- Tema y Lección editables → **guardar cambios** manda sólo `topic` y `lesson`:
  el estado no cambia.
- Si no está refutada, **Refutar (opcional)**: un motivo ("Ej: el índice de
  lectura mostraba secciones duplicadas que el documento no tiene."). Con motivo
  escrito aparece **refutar** → `PATCH` con `estado: "refutada"` y
  `motivoDeRefutacion`.
- Si está refutada, su motivo y **restaurar** → `estado: "activa"`, que vuelve a
  entrar al prompt y borra el motivo.

**Refutar no es borrar**: la lección deja de entrar al prompt pero queda con su
motivo, porque el registro de por qué algo se creyó y por qué era falso evita
re-aprender el mismo error. Es una decisión humana a propósito: un agente que
discrepa registra la corrección con evidencia, y la tensión la resuelve quien mira
esta pantalla. El servidor exige el motivo (400 sin él). El caso que lo motivó
—una lección falsa sobre `edit_artifact`— está en
[[CU-12 Refutar una lección falsa]].

## Casos borde

- La UI no ofrece marcar una lección como **cuestionada**: sólo la muestra.
  El `PATCH` lo acepta.
- Se muestra `timesConfirmed`, no la lista `confirmaciones` (quién confirmó y en
  qué corrida).
- Una respuesta a una solicitud cuya corrida ya terminó aparece acá como lección
  ([[Pantalla Solicitudes]]).

## Qué fijan los tests

`apps/server/src/routes.test.ts` → "memoria por HTTP": un body inválido contesta
400 con el detalle de Zod; cargar dos veces la misma lección confirma en vez de
crear una gemela; el `PATCH` refuta con motivo y la lección queda fuera del prompt
sin borrarse; el `DELETE` la saca de la base y del vault. Además, "una fila vieja
sale con estado activa y sin evidencia". `apps/server/src/memoria-persistida.test.ts`
recorre el circuito completo: persiste, llega al prompt y la refutación la saca.

## Fuentes

- `apps/web/src/routes/Memory.tsx` — `Memory`, `EditorDeLeccion`.
- `apps/web/src/api.ts` — `learnings`, `addLearning`, `updateLearning`,
  `deleteLearning`.
- `apps/server/src/routes.ts` — rutas `/api/companies/:id/learnings`,
  `learningPatch`.
- `packages/shared/src/schema.ts` — `learningSchema`, `normalizarLeccion`.

## Ver también

- [[Memoria de la empresa]]
- [[CU-12 Refutar una lección falsa]]
- [[Vault de contexto]]
- [[Prompt de un turno]]
