---
tags: [contribuir, plataforma]
aliases: [Nueva herramienta, agregar tool]
---

# Cómo agregar una herramienta

Guía para sumar una `RegisteredTool` al sistema sin romper las reglas que no se
ven leyendo un solo archivo. El contrato y el ciclo de ejecución están en
[[Herramientas y tool router]]. Si la herramienta **produce un archivo**, leé
además [[Cómo agregar una habilidad]]. Un servidor MCP no se programa: se conecta
([[CU-05 Conectar un servidor MCP]]) o se suma a la tienda
([[Cómo agregar un servidor a la tienda MCP]]).

## 1. Elegí el origen

| Origen | Cuándo | Consecuencia |
|---|---|---|
| `coordination` | sin ella los agentes no podrían operar como organización | **todo rol la recibe**, no se siembra, no se prueba en el Hub |
| `capability` | una acción hacia afuera que no todos necesitan | por `toolIds`, se siembra, **compite** en el ranking (12 lugares) |
| `skill` | produce algo o trabaja sobre la salida, el código, el teléfono | por `toolIds`, se siembra, fija en el router |
| `mcp` / `creada` | no se programan | ver [[Integración MCP]] y [[Herramientas compuestas]] |

> [!warning] El umbral para `coordination` es alto
> `calcular` está ahí porque hacer una cuenta bien es higiene, no una capacidad
> que haya que asignar rol por rol. Ese es el criterio, no "es útil". Además cada
> una más se reenvía en **todos** los turnos de **todos** los roles: ya son 27.

## 2. Escribila

```ts
const miTool: RegisteredTool = {
  name: "mi_tool",                 // snake_case, único en el registro
  origin: "capability",
  description: "Qué hace y CUÁNDO usarla, en palabras que la tarea diría",
  inputSchema: {
    type: "object",
    properties: { texto: { type: "string", description: "…" } },
    required: ["texto"],
    additionalProperties: false,   // ← importa
  },
  readOnly: true,
  requiresApproval: false,
  async execute(args, ctx) {
    // validar, hacer, y contar el resultado
    return ok("qué pasó, en una frase", "recorte para la UI");
  },
};
```

- **Usá `ok` y `fail` de `types.ts`**: `fail` antepone `ERROR:`, que es lo que el
  loop y las huellas de fallo esperan. (`contexto.ts` y `calculo.ts` arman sus
  resultados a mano; no los copies.)
- **La descripción es la interfaz y el ranking**: el router puntúa por palabras
  del nombre (×3) y de la descripción (×1) contra la tarea.
- **El error dice qué hacer en su lugar**: lista lo que sí existe, nombra a quién
  escalar, sugiere la herramienta correcta. Un "no existe" a secas hace que el
  modelo reintente lo mismo.
- **Validá los requeridos** aunque estén en el esquema: si el modelo agota
  `max_tokens`, los argumentos llegan cortados (con `__raw`) y sin los campos del
  final (`readRequired` en `coordination.ts`).
- **Nada de estado en el closure por turno**: el actor viene en `ctx`, nunca en
  una variable compartida (hubo turnos paralelos firmados por el rol equivocado).

## 3. Reglas del esquema y del memo

- **`additionalProperties: false`**: así la huella del memo se calcula sólo sobre
  lo declarado y un argumento inventado (`start=4000`) no hace parecer nueva la
  misma lectura. Costó 534k tokens de entrada una vez.
- **`clavesDeCache`** si llevás argumentos decorativos (un `concepto` para la
  traza): la misma cuenta con otro rótulo no se vuelve a ejecutar.
- **Si tu herramienta acota lecturas** con un argumento nuevo (una página, una
  ventana), agregá su nombre a `ACOTADORES` en `packages/engine/src/acotar.ts`:
  es lo que el aviso de recorte le ofrece al agente en un turno delegado.
- **`readOnly` honesto**: `true` significa que corre en paralelo con otras
  lecturas y que una repetición devuelve un puntero. Si escribe algo —aunque sea
  un PNG de revisión— va `false`.

## 4. Aprobación

`requiresApproval: true` hace que no corra: abre una aprobación y, al concederse,
el motor la ejecuta con esos argumentos. Es una propiedad **del código**: la
columna de la base es un espejo y editarla no cambia nada. Candidatas: lo que
escribe fuera del sistema o se lleva datos sin vuelta (`limpiar_datos_de_la_app`).
Una herramienta con aprobación no puede ser paso de una compuesta.

## 5. Registrala

| Origen / tipo | Dónde |
|---|---|
| coordinación global | array `coordinationTools` (`packages/tools/src/coordination.ts`) |
| coordinación que necesita algo de la empresa | `Runtime.companyRuntime` (como `crear_herramienta` o las de contexto) |
| `capability` sin dependencias | `capabilityTools` (`capability.ts`) |
| `capability` por empresa | `companyRuntime` (como `send_email`) |
| habilidad | `createSkillTools` (`skills/index.ts`) |
| código / teléfono / R2 | su `crear…` en `packages/tools/src/codigo/` **y** el nombre en `HERRAMIENTAS_DE_CODIGO` (`apps/server/src/codigo-servidor.ts`), que es la lista que se da de baja al re-registrar |

Exportala desde `packages/tools/src/index.ts` si el servidor la necesita.

**La que no se puede cumplir, no se registra** (sin Chrome, sin adb, sin key).
La excepción es consciente y se documenta: si registrarla igual sirve porque su
error explica qué falta y quién lo resuelve (código sin repo, R2, correo).

## 6. Que llegue a los roles

- `capability` y `skill` se siembran solas en empresas nuevas
  (`Runtime.sembrarHerramientas`) y al cargar código; el seed de ejemplo
  (`apps/server/src/seed.ts`) las toma de `describe()`. Sin fila en `tools`,
  `role.toolIds` no puede apuntarla.
- Si una plantilla de equipo debería traerla, sumala en
  `packages/shared/src/plantillas.ts` ([[Cómo agregar una plantilla de equipo]]).
  Los roles ya creados no se actualizan solos.
- Si es para el Mejorador o el QA móvil: el Mejorador toma todo
  `HERRAMIENTAS_DE_CODIGO` y se pone al día antes de cada pedido; el QA móvil usa
  `QA_MOVIL.herramientas`.
- Si el agente necesita saber **cuándo** usarla y el prompt del rol es viejo,
  decilo en el resumen del turno (como `bloqueDeTelefono`), no sólo en el prompt.

## 7. Listas que hay que tocar según lo que haga

| Si tu herramienta… | Sumala a | Archivo |
|---|---|---|
| sólo habla (mensaje o solicitud) | `COMUNICACION` (no invalida el memo) | `packages/engine/src/loop.ts` |
| sólo habla o consulta estado | `HABLAR_NO_ES_EVIDENCIA` (no respalda una lección) | `packages/tools/src/coordination.ts` |
| escribe código | `HERRAMIENTAS_QUE_ESCRIBEN_CODIGO` (arriendo y "la corrida produjo algo") | `packages/tools/src/codigo/index.ts` |
| crea una solicitud o un entregable y es de coordinación | un caso en `emitCoordinationEffect` para su evento | `packages/engine/src/loop.ts` |
| cambia algo que la UI tiene que ver | una variante de evento | [[Cómo agregar un evento]] |

## 8. Red y tiempos

Toda llamada de red lleva **corte por tiempo** (`AbortSignal.timeout`,
combinado con `ctx.signal`): un endpoint que acepta la conexión y se calla deja
el turno colgado para siempre. `fetch_url` corta a 20 s, el correo a 15 s,
imágenes a 90 s, MCP a 60 s. `packages/tools` no lee el disco del servidor ni
decide rutas: pedí un *storage* inyectado (`SkillStorage`, `CodigoStorage`…) y
dejá que el servidor sanee.

## 9. Operaciones en lote

Si el agente va a necesitarla N veces, dale un argumento de lote: `delete_files`
acepta `kind` porque encadenar una llamada por archivo hacía fallar al agente a
la mitad; `read_artifact` acepta varias secciones separadas por coma porque cada
llamada en un turno delegado cuesta una vuelta entera.

## 10. Tests

Junto al archivo (`*.test.ts`), con un `AgentWorkspace` falso. Probá **el error
tanto como el camino feliz**, y fijá la guardia que motivó la herramienta con el
incidente en el comentario. `npx vitest run packages/tools/src/<archivo>.test.ts`
y `npm run typecheck`.

## Lista de control

- [ ] origen correcto y registrada en el lugar correcto
- [ ] `additionalProperties: false` y `clavesDeCache` si hay argumentos decorativos
- [ ] descripción que dice cuándo usarla
- [ ] errores con `fail` que dicen qué hacer
- [ ] `readOnly` y `requiresApproval` honestos
- [ ] corte por tiempo si sale a la red
- [ ] no se registra si no se puede cumplir (o se explica la excepción)
- [ ] sembrada / en las listas del paso 7 si corresponde
- [ ] tests del camino feliz y del error
- [ ] [[Referencia de herramientas]] y [[Catálogo de herramientas]] actualizados

## Ver también

- [[Herramientas y tool router]] · [[Cómo agregar una habilidad]] · [[Guía de contribución]]
