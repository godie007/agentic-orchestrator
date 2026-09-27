---
tags: [capacidad, organización]
aliases: [convocar_especialista, Convocatoria, incorporarRol, TOPE_DE_CONVOCATORIA, Especialista]
---

# Especialistas convocados

`convocar_especialista` incorpora un rol **en el acto**, sin esperar
aprobación, en plena corrida. Es la diferencia entre una empresa que puede
abordar un problema que no previó y una que sólo ejecuta el organigrama con el
que arrancó. El convocado queda guardado como rol de la empresa, así que
sobrevive a la corrida que lo creó.

`request_new_role` sigue existiendo y no sobra: la diferencia no es de permisos
sino de **tiempo**. Proponer y esperar a una persona es lo correcto para sumar a
alguien de forma permanente; convocar es para cuando el trabajo ya empezó, falta
una capacidad concreta y esperar significa perder la corrida.

## Contrato

`packages/tools/src/coordination.ts` → `convocarEspecialista`, coordinación.

| Argumento | Obligatorio | Qué es |
|---|---|---|
| `name` | sí | Nombre propio |
| `title` | sí | Cargo |
| `department` | sí | Área; si no existe, se crea |
| `system_prompt` | sí | Sus instrucciones: es lo único que va a saber de su trabajo |
| `tools` | no | Nombres exactos de herramientas del catálogo; las de coordinación ya las tiene |
| `reason` | sí | Qué capacidad falta y qué se desbloquea |

Pasos:

1. Campos obligatorios (`readRequired`).
2. **Sólo `executive`.** Si no: "Convocar gente la decide quien responde por la
   empresa, y vos sos *autoridad*. Proponelo con request_new_role… o pedile a tu
   superior que lo convoque".
3. **Tope por corrida**: si ya van `TOPE_DE_CONVOCATORIA` (4), rechaza: "el
   problema no es de gente: revisá si el encargo está bien entendido o repartí
   distinto el trabajo".
4. Nombre no repetido (sin mayúsculas).
5. **Reparte, no inventa**: las herramientas pedidas se buscan en el catálogo
   (`workspace.tools`); las que existen se otorgan por id y las que no se
   **nombran** en la respuesta.
6. `RunState.incorporarRol` crea el rol.
7. Respuesta: "*Nombre* (*cargo*) se incorporó al equipo y arranca en el ciclo
   siguiente. Tiene … además de las de coordinación. Ojo: *X* no existe en este
   proyecto… Escribile con send_message para darle el encargo: todavía no sabe
   qué tiene que hacer."

## Cómo nace el rol

`RunState.incorporarRol` (`packages/engine/src/state.ts`):

| Campo | Valor | Por qué |
|---|---|---|
| Departamento | El existente con ese nombre (sin mayúsculas) o uno nuevo, en `x = 120 + n·260, y = 440` | Un especialista suele traer un área que no existía |
| `authority` | `executor` | No puede convocar a su vez |
| `reportsTo` | Quien lo convocó | El `executive` le puede asignar tareas y él escalarle |
| `model` | El de la empresa con escalado `cheap`..`standard` (`free`..`free` si la empresa está en `free`) | Sus turnos livianos no tienen por qué correr con el modelo del CEO; en `free` escalar iría derecho a un 402. Un slug fijo de la empresa se respeta |
| `toolIds` | Las otorgadas | — |
| `maxTurns` | 10 | — |
| `spendApprovalThresholdUsd` | `null` | — |

Después: `addRole` lo suma al roster vivo con **bandeja propia**, suma 1 al
contador de convocados y `persistence.saveRole(role, departamentoNuevo?)`, que
en el servidor guarda el departamento (si es nuevo) y el rol.

## Los tres frenos son del ejecutor

| Freno | Sin él |
|---|---|
| Sólo convoca `executive` | Cualquiera suma gente |
| El convocado nace `executor` | Cada especialista descubre que le falta otro y la corrida termina con treinta agentes hablándose entre ellos |
| Tope de 4 por corrida | Si un encargo necesita más de cuatro capacidades que la empresa no tenía, nadie entendió el encargo; sumar agentes lo empeora porque cada uno agrega mensajes que los demás tienen que leer |

Más una cuarta regla: **sólo se otorgan herramientas del catálogo**. Una que no
existe se nombra en vez de descartarse en silencio: un especialista que nace
sin la herramienta prometida gasta su primer turno buscándola, y desde afuera
parece que no entendió la tarea.

## Cuándo empieza a trabajar

La herramienta dice "en el ciclo siguiente", que es el peor caso. Como el ciclo
es una cadena, si quien lo convocó le escribe en ese mismo turno, el convocado
tiene bandeja y todavía no corrió: puede tomar el trabajo **en la misma vuelta**
(ver [[Scheduler y ciclo de una corrida]]). Sin mensaje, no tiene nada que hacer.

## Convocar vs. proponer

| | `convocar_especialista` | `request_new_role` |
|---|---|---|
| Quién | Sólo `executive` | Cualquiera |
| Decide | El agente, en el acto | Una persona, desde Solicitudes |
| Autoridad del nuevo | `executor` | `executor` propuesto (la persona puede editar la propuesta) |
| Herramientas | Las pedidas que existan | Ninguna (`toolIds: []`) |
| `maxTurns` | 10 | 6 |
| Escalado | `cheap`..`standard` fijo | `conEscaladoPorAutoridad` |
| Entra a la corrida | Ya | Al aprobar, en la corrida que lo pidió |

## Casos borde

- El tope es **por corrida** (contador en memoria de `RunState`): la empresa
  puede crecer de a cuatro por corrida sin techo global. Los convocados se
  acumulan como roles de la empresa; sacarlos es una decisión de una persona.
- No hay evento propio: en la traza se ve la llamada a la herramienta; el
  organigrama muestra el rol cuando la UI recarga la empresa.
- Un nombre de herramienta mal escrito no se otorga: la respuesta lo nombra
  para que el `executive` corrija o se la asigne después.

## Qué fijan los tests

- `packages/tools/src/coordination.test.ts` → `convocar_especialista`: un executor no puede; un manager tampoco; un executive sí y el especialista queda con sus herramientas; hay tope y el mensaje dice qué revisar; no se duplica a alguien del equipo; una herramienta inexistente se nombra; sin herramientas lo dice.
- `packages/engine/src/memory.test.ts` → "un rol incorporado empieza a trabajar y los demás lo ven".

## Fuentes

- `packages/tools/src/coordination.ts` → `convocarEspecialista`, `TOPE_DE_CONVOCATORIA`
- `packages/engine/src/state.ts` → `incorporarRol`, `especialistasConvocados`, `addRole`
- `packages/tools/src/types.ts` → `AgentWorkspace.incorporarRol`
- `apps/server/src/runtime.ts` → persistencia `saveRole` en `startRun`, `applyRequest` (`create_role`)

## Ver también

- [[Organización de agentes]]
- [[Aprobaciones y solicitudes]]
- [[Escalado por dificultad]]
- [[Herramientas compuestas]]
