---
tags: [adr, organización]
aliases: [crear_herramienta, compuestas.ts, crearToolCompuesta, origin creada]
---

# ADR-020 Herramientas compuestas declarativas

**Estado:** aceptada

## Contexto

Un rol que repite siempre el mismo procedimiento —leer un entregable, verificar
sus cifras, exportar el PDF— lo re-descubre en cada corrida y lo paga en
iteraciones. Darle a la empresa la capacidad de **crearse herramientas** es la
forma de conservar ese procedimiento. La pregunta es cuánto poder dar: una
herramienta con código del agente corriendo en el servidor necesitaría sandbox,
aprobación y revisión.

## Decisión

Una herramienta creada por un agente es **declarativa**: una secuencia de
herramientas que ya existen, con argumentos fijos y huecos `{{parametro}}`
(`crear_herramienta`, `packages/tools/src/compuestas.ts`).

- Hasta **6 pasos** (`MAX_PASOS`). Los huecos definen el esquema de entrada,
  cerrado con `additionalProperties: false` para que el memo de lecturas
  funcione. Un hueco que es el valor entero conserva el tipo del argumento.
- **No hay código del agente**: cada paso pasa por el mismo ejecutor, con las
  mismas guardias y la misma traza que si el agente lo llamara a mano. Por eso
  no hace falta sandbox ni aprobación: no puede hacer nada que sus componentes
  no pudieran.
- **Los frenos viven en el ejecutor**: crea `executive` o `manager` (un
  ejecutor pide lo que le falta); sólo compone lo que el creador tiene
  asignado (crear no escala permisos); sin compuestas de compuestas (dos que se
  llaman entre sí no terminan nunca); sin pasos con `requiresApproval` (la
  secuencia no puede quedar esperando a una persona por la mitad).
- **Se corta en el paso que falla** y lo nombra: un pipeline que sigue después
  de un fallo produce basura con cara de éxito. Los componentes se resuelven
  **al invocar**: si uno se dio de baja, el error lo dice por su nombre.
- **Persistencia**: la fila se guarda con `origin: "creada"` y su `composicion`,
  sobrevive a la corrida y se le otorga a quien la creó
  (`AgentWorkspace.incorporarHerramienta`); `Runtime.companyRuntime` la vuelve
  ejecutable al levantar. `persistMcpTools` **saltea** las creadas: `describe()`
  no lleva la composición y re-guardarlas desde ahí las dejaba vacías.
- **El router las expone siempre**, como a las habilidades: alguien la armó a
  propósito para ese trabajo.

## Alternativas consideradas

**Código del agente (un script, una función JS).** Rechazada: exige sandbox,
revisión humana y un modelo de permisos nuevo, para ganar poco sobre componer lo
que ya existe.

**Guardar el procedimiento como lección en la memoria.** Rechazada como único
mecanismo: una lección se lee, no se ejecuta, y el agente igual paga cada paso.

**Macros aprobadas por una persona.** Rechazada: si la composición no puede
hacer nada nuevo, la aprobación no protege de nada.

## Consecuencias

### A favor

- Memoria de procedimiento sin superficie de ataque nueva.
- La traza de una compuesta es la de sus pasos.

### En contra / lo que se resignó

- **Sin lógica**: ni condicionales, ni bucles, ni usar la salida de un paso como
  argumento del siguiente; sólo argumentos fijos y parámetros.
- **Un componente que cambia su esquema rompe la compuesta** en el momento de
  usarla, no al crearla.
- **Dos defensas sin test propio**: que `persistMcpTools` saltee las creadas y
  que el router las exponga siempre están en el código pero ningún test las fija
  (el test del router cubre coordinación y habilidades).

## Qué lo fija

- `packages/tools/src/compuestas.test.ts` → "sustituye los huecos y encadena los
  pasos en orden", "se detiene en el paso que falla y dice cuál fue", "nombra al
  componente que ya no está disponible", "un executor no crea herramientas", "no
  compone lo que el creador no tiene asignado", "no acepta pasos que requieren
  aprobación humana", "no acepta compuestas de compuestas", "crea, registra en
  vivo y persiste vía el workspace".

## Fuentes

- `packages/tools/src/compuestas.ts` → `createCrearHerramienta`,
  `crearToolCompuesta`, `extraerParametros`, `MAX_PASOS`, `HUECO`
- `packages/tools/src/router.ts` → `isAlwaysExposed`
- `apps/server/src/runtime.ts` → `companyRuntime`, `persistMcpTools`
- `packages/shared/src/schema.ts` → `toolOriginSchema` (`creada`), `composicion`

## Ver también

- [[Herramientas compuestas]] · [[Herramientas y tool router]] · [[Especialistas convocados]]
