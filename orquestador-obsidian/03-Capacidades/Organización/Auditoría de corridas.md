---
tags: [capacidad, organización]
aliases: [auditoria.ts, auditarCorrida, npm run auditar, auditar-corrida.ts, Auditoría procedimental]
---

# Auditoría de corridas

El motor y la UI evalúan el **artefacto**: ¿el entregable quedó bien armado? La
auditoría evalúa la **trayectoria**: ¿el proceso que lo produjo fue el que dice
haber sido? Un resultado correcto por un proceso corrupto es tan grave como uno
incorrecto, y no se ve mirando sólo el artefacto.

Nos pasó: un rol con `export_pdf` asignada dejó un `INSTRUCCIONES-PDF.txt`
pidiéndole a una persona que imprimiera a mano, e informó la tarea como
completada. La corrida terminó "exitosa", el entregable no existía, y nadie lo
hubiera notado sin mirar qué herramientas se ejecutaron de verdad.

## Cómo se usa

```bash
npm run auditar -- --run=<runId> [--db=<ruta>]
```

`scripts/auditar-corrida.ts` abre la base en **sólo lectura**, trae la traza de
la corrida (`events` ordenados por `seq`), la pasa por `auditarCorrida` e
imprime los hallazgos ordenados por severidad (🔴 alta, 🟡 media, 🔵 info) con
tick y rol, y al pie las métricas por rol. Sin eventos para esa corrida, sale
con error. No hay endpoint ni pantalla: es una herramienta para una persona.

## `auditarCorrida`

`apps/server/src/auditoria.ts`. Es **pura**: recibe la traza persistida y no
toca la base ni la red, así se pueden auditar corridas viejas y testear sin
`FakeProvider`. Devuelve `{hallazgos, metricas}`; cada hallazgo es
`{regla, severidad, tick, roleId, detalle}`.

| Regla | Severidad | Qué señala | Criterio |
|---|---|---|---|
| `turno-sin-modelo` | media | Un turno que cerró sin `model.selected` | `agent.turn_end` sin `model.selected` del mismo rol y tick: algo se saltó el camino normal y su costo queda sin explicar |
| `exito-sin-respaldo` | alta | El resumen declara una entrega que nada respalda | `summary` que calza con `RX_DECLARA_ENTREGA` (entregué, exporté, completé, generado, "listo el", "terminé de producir/generar/exportar") sin ningún `tool.end` exitoso de ese rol en ese tick |
| `export-sin-verificacion` | alta | Exportó sin verificar cifras | `export_pdf`/`export_docx` exitoso sin un `verificar_cifras` exitoso **antes**, de cualquier rol, en la corrida |
| `tasa-de-fallos` | info | Un rol que falla mucho | Al menos 5 llamadas y más del 30% fallidas |
| `relectura-repetida` | info | Lecturas repetidas | Más de 6 `read_artifact` o `fetch_url` del mismo rol en el mismo tick: la forma que tomó el caso de 534k tokens por un argumento de paginación inventado |

Métricas: llamadas y fallidas totales y por rol, contando `tool.end`.

## Límites

Es una heurística para que una persona lea, no un corte automático:

- `exito-sin-respaldo` no detecta al que ejecutó **algo** pero entregó lo
  equivocado (el caso del `.txt` tuvo llamadas exitosas). Eso sigue
  necesitando revisión con ojos. Y cualquier `tool.end` exitoso respalda, también
  un `cli:Read` de un turno delegado.
- `export-sin-verificacion` no sabe si el documento tenía cifras: la exportación
  sólo exige verificación cuando hay montos o porcentajes, así que un documento
  sin números exportado sin verificar sale como hallazgo **alto** falso.
  Tampoco mira si la verificación encontró cifras malas (eso lo frena la propia
  exportación).
- `tasa-de-fallos` cuenta como fallo el `tool.end` de una llamada que quedó
  **esperando aprobación** (`ok: false`).
- Lo que corre dentro de una [[Herramientas compuestas|herramienta compuesta]]
  no deja `tool.end` propio: un `export_pdf` adentro de una compuesta no se ve.
- `export_video`, `export_slides` y el resto de las habilidades no están en las
  reglas de exportación.

## Auditoría procedimental vs. `check_activity`

| | `check_activity` | `auditarCorrida` |
|---|---|---|
| Quién la usa | Un agente, en la corrida | Una persona, después |
| Fuente | `RunState.activity` (últimas 500) | La traza entera persistida |
| Qué responde | Qué ejecutó cada uno | Si el proceso respalda lo que se declaró |

Ver [[Coordinación entre agentes]] y [[CU-04 Control de calidad entre agentes]].

## Qué fijan los tests

`apps/server/src/auditoria.test.ts`: turno sin `model.selected` señalado y con él limpio; entrega declarada sin nada ejecutado señalada, nueve fallos declarados no son éxito corrupto, un `tool.end` exitoso respalda; export sin verificación señalado y con verificación limpio; tasa de fallos con y sin el mínimo de 5 llamadas; más de 6 lecturas señaladas y 6 no; métricas totales y por rol.

## Cómo extender

Una regla nueva es otra función pura `(eventos) => Hallazgo[]` sumada en
`auditarCorrida`, con su test. Si necesita un dato que la traza no tiene, el
dato va primero como evento (ver [[Cómo agregar un evento]]).

## Fuentes

- `apps/server/src/auditoria.ts` → `auditarCorrida`, `turnoSinModelo`, `exitoSinRespaldo`, `exportSinVerificacion`, `tasaDeFallos`, `relecturaRepetida`, `calcularMetricas`, `RX_DECLARA_ENTREGA`
- `scripts/auditar-corrida.ts`
- `package.json` → script `auditar`

## Ver también

- [[Observabilidad y trazas]]
- [[Referencia de eventos]]
- [[Supervisión y continuidad]]
- [[Comandos]]
