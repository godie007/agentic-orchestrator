---
tags: [capacidad, organización]
aliases: [crear_herramienta, compuestas.ts, crearToolCompuesta, createCrearHerramienta, Herramienta creada, origin creada, composicion]
---

# Herramientas compuestas

Un agente puede crearse herramientas, pero **sólo componiendo las que ya puede
ejecutar**. `crear_herramienta` arma una herramienta **declarativa**: una
secuencia de hasta 6 pasos de herramientas existentes, con argumentos fijos y
huecos `{{parametro}}` que se completan al invocarla. La empresa la conserva
(`origin: "creada"`) y sobrevive a la corrida, como un especialista convocado.

Lo que aporta es **memoria de procedimiento**: un rol que descubrió que su
trabajo siempre es "leer el entregable, verificar sus cifras, exportar el PDF"
lo deja armado una vez, con nombre. No hay código del agente corriendo en el
servidor, y por eso no necesita sandbox ni aprobación: no puede hacer nada que
sus componentes no pudieran.

## Contrato de `crear_herramienta`

`packages/tools/src/compuestas.ts` → `createCrearHerramienta`. Es
`origin: "coordination"` (todos los roles la ven) pero se registra **por
empresa** en `Runtime.companyRuntime`, porque necesita el catálogo vivo de esa
empresa para validar y resolver pasos.

| Argumento | Obligatorio | Qué es |
|---|---|---|
| `name` | sí | Minúsculas, números y guiones bajos: `exportar_informe_semanal` |
| `description` | sí | Qué produce y cuándo usarla: la leen los roles que la reciban |
| `pasos` | sí | Lista de `{tool, args}`, entre 1 y 6 |

Validaciones, en orden:

1. **Autoridad**: un `executor` no crea ("pedila con request_tool_access o
   escalale a tu superior").
2. **Nombre**: `normalizarNombre` (minúsculas, sin tildes, lo que no sea
   `a-z0-9_-` pasa a `-`, hasta 64) y después `-` → `_`. Vacío → rechazo. Si ya
   existe en el registro o en el catálogo → rechazo.
3. `description` no vacía.
4. Entre 1 y `MAX_PASOS` (6) pasos: "Más que esto no es una herramienta, es un
   guion."
5. Cada paso:
   - dice qué herramienta usa y existe en el registro;
   - **no** es otra compuesta ("compuestas de compuestas no están permitidas":
     dos que se llamen entre sí no terminan nunca);
   - **no** requiere aprobación (la secuencia no puede quedar esperando a una
     persona por la mitad);
   - es de coordinación o **está asignada al creador** ("crear no escala
     permisos": una compuesta con un paso que no tenés sería una puerta lateral);
   - `args` que no sea un objeto se toma como `{}`.

## La fila que se guarda

```ts
{
  id: "tol_…", name, origin: "creada", description,
  inputSchema: { type: "object", properties: { <param>: { type: "string" } },
                 required: [<params>], additionalProperties: false },
  mcpServerId: null, requiresApproval: false, readOnly: false,
  composicion: { pasos: [{ tool, args }], creadaPorRoleId }
}
```

Los parámetros salen de los huecos (`extraerParametros`: en orden de aparición,
sin repetir, recorriendo objetos y listas anidados). El esquema cerrado con
`additionalProperties: false` es lo que deja funcionar al memo de lecturas.

Orden de registro: primero `deps.registrar(crearToolCompuesta(fila))` en el
registro vivo de la empresa, después `workspace.incorporarHerramienta(fila)`
(entra al catálogo de la corrida, se persiste con `saveTool` y se le otorga al
creador). Si registrar fallara, no queda persistida una herramienta que nadie
puede invocar. El creador la usa desde su **próximo turno** (la lista del turno
en curso ya está fijada).

## Cómo se ejecuta

`crearToolCompuesta(tool, resolver)`:

1. Falta algún parámetro (nulo o en blanco) → "faltan los parámetros …".
2. Por cada paso, **resuelve el componente al invocar**, no al registrar: si se
   dio de baja (un servidor MCP desconectado), el error lo nombra en el momento
   en que importa y lista lo que sí se ejecutó.
3. `sustituir`: un hueco que es el valor **entero** conserva el tipo del
   argumento; dentro de un texto se reemplaza por `String(arg ?? "")`.
4. Ejecuta el componente con el mismo `ctx` (mismo actor, misma corrida).
5. Si un paso falla, **se corta ahí** y lo nombra: "falló el paso *N*
   (*herramienta*) y la secuencia se detuvo ahí", con las salidas anteriores. Un
   pipeline que sigue después de un fallo produce basura con cara de éxito.
6. Éxito: todas las salidas como `[paso N: herramienta]` y el preview
   "🧩 nombre: N paso(s) ok".

La compuesta es `readOnly: false`: corre en serie y vacía el memo, aunque todos
sus pasos lean.

## Al levantar la empresa, y dos trampas fijadas

`Runtime.companyRuntime` recorre `store.listTools` y registra como ejecutable
cada fila `creada` con `composicion` (una fila rota se saltea en vez de tumbar
el runtime).

> [!danger] `persistMcpTools` saltea las creadas
> `ToolRegistry.describe()` no lleva la composición. Re-guardarlas desde ahí las
> dejaba **vacías**: una herramienta que existe pero no ejecuta nada. Por eso
> `Runtime.persistMcpTools` hace `continue` con `origin === "creada"`.

> [!note] El router las expone siempre
> `isAlwaysExposed` (`packages/tools/src/router.ts`) trata a las creadas como a
> las habilidades: alguien la armó a propósito para ese trabajo, y perderla en
> el ranking frente a una tool de MCP cualquiera anula el motivo por el que
> existe. Ver [[Herramientas y tool router]].

## Límites y seguridad

Los frenos viven en el ejecutor, pero hay que saber **cuándo** se evalúan:

> [!warning] Los permisos se chequean al crear, no al invocar
> - La regla "sólo compone lo que el creador tiene asignado" se aplica al
>   crearla. Si después la compuesta se le otorga a **otro rol** (por
>   `request_tool_access` o desde la configuración), ese rol ejecuta los pasos
>   aunque no tenga asignados los componentes.
> - La regla "sin pasos que requieran aprobación" también es de creación: si un
>   componente pasa a requerir aprobación después (por ejemplo, un servidor MCP
>   al que se le apaga `autoApproveTools`), la compuesta lo ejecuta sin abrir
>   aprobación, porque llama a `execute` directo.

> [!warning] Los pasos no pasan por el loop
> El comentario de `compuestas.ts` dice que cada paso pasa "por el mismo
> ejecutor, con las mismas guardias y la misma traza", pero los pasos se
> invocan con `componente.execute` directo, no por `executeOne`: no emiten
> `tool.start`/`tool.end` propios, no dejan entrada en la actividad (en
> `check_activity` y en la [[Auditoría de corridas]] aparece sólo la
> compuesta), no pasan por el memo ni por el corte de fallos repetidos. Las
> guardias **internas** de cada herramienta sí aplican (la verificación de
> cifras de `export_pdf`, `puedeBorrar` con la autoridad de quien invoca, el
> saneo de rutas).

Otros límites:

- Todos los parámetros se declaran `string`: aunque `sustituir` conserva tipos,
  el modelo los va a mandar como texto.
- No hay endpoint para borrar herramientas: una creada queda en el catálogo de
  la empresa. En la configuración aparece en el grupo "Creadas por agentes".
- El registro vivo es de la **empresa**, compartido por sus corridas: una
  compuesta creada en una corrida existe para las otras en el acto.

## Qué fijan los tests

`packages/tools/src/compuestas.test.ts`:

- `extraerParametros` encuentra huecos anidados, en orden y sin repetir.
- Ejecución: sustituye y encadena en orden; rechaza si falta un parámetro; se detiene en el paso que falla y lo dice; nombra al componente que ya no está.
- Frenos: un executor no crea; no compone lo no asignado; no acepta pasos con aprobación; no acepta compuestas de compuestas; crea, registra en vivo y persiste vía el workspace; rechaza un nombre existente.

## Fuentes

- `packages/tools/src/compuestas.ts` → `extraerParametros`, `sustituir`, `crearToolCompuesta`, `createCrearHerramienta`, `MAX_PASOS`
- `packages/engine/src/state.ts` → `incorporarHerramienta`
- `apps/server/src/runtime.ts` → `companyRuntime`, `persistMcpTools`
- `packages/tools/src/router.ts` → `isAlwaysExposed`
- `packages/shared/src/schema.ts` → `toolSchema.composicion`, `toolOriginSchema`
- `packages/shared/src/mcp-config.ts` → `normalizarNombre`

## Ver también

- [[Organización de agentes]]
- [[Catálogo de herramientas]]
- [[Cómo agregar una herramienta]]
- [[Especialistas convocados]]
