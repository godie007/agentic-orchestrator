---
tags: [arquitectura, pantalla]
aliases: [Proveedores, Pantalla de proveedores, Costos, Pantalla de costos, Mantenimiento desde la UI, Providers, Costs, CostTable]
---

# Pantalla Configuración

Las pantallas de apoyo de `apps/web/src/routes/Settings.tsx` que no son el
diseñador de la empresa: **Proveedores** (qué modelo resuelve cada tier),
**Costos** (cuánto gastó una corrida) y **Mantenimiento** (lo que se limpia, al
pie de la pestaña Empresa). El tema claro/oscuro no es una pantalla: es el botón
del header ([[Sistema de diseño y temas]]).

## Proveedores

**Ruta:** `/proveedores` —global, no exige proyecto: se puede revisar antes de
crear el primero—. **Componente:** `Providers`.

`["providers"]` → `GET /api/providers`: por cada proveedor configurado el servidor
corre su `healthCheck`, lista los modelos y resuelve los cuatro tiers contra el
catálogo vivo (`resolverTodosLosTiers`). Tarda lo que tarde el proveedor más lento;
mientras, "Consultando proveedores…".

Un panel por proveedor, en dos columnas:

- título (`label`) y estado `ready` o `error`;
- `detail`: lo que dijo el chequeo de salud;
- "Tiers resueltos contra el catálogo vivo": para `free`, `cheap`, `standard` y
  `smart`, el slug elegido, el precio mezclado en US$/MTok y el **motivo** de la
  elección; si no hay candidato, en amarillo, "Sin candidatos. Asigná un modelo
  explícito a los roles que usen este tier."

Sin proveedores: "No hay ningún proveedor configurado. Copiá `.env.example` a
`.env`, completá al menos una API key y reiniciá el servidor." Cómo se eligen los
modelos y por qué las bandas son disjuntas: [[Capa LLM y tiers]]; cada
proveedor, en su nota ([[Proveedor claude-code]],
[[Proveedor Anthropic y claude-sesion]], [[Proveedor opencode]],
[[Proveedor OpenRouter]], [[Proveedores OpenAI, NVIDIA y Ollama]]).

> [!note] Un error se lee como "no hay proveedores"
> Si el pedido falla, la lista queda vacía y la pantalla muestra el mensaje de
> configuración. `modelCount` llega en la respuesta y no se muestra.

## Costos

**Ruta:** `/p/:companyId/costos`. **Componente:** `Costs`.

Un selector de corrida (la más reciente por defecto; fecha y 40 caracteres del
objetivo) y el `ledger` de esa corrida (`["run", runId]` → `GET /api/runs/:id`).
La barra superior dice "US$ gastado de US$ tope · N llamadas" y una barra de
progreso, amarilla pasado el 80% del tope.

Dos tablas, ordenadas por costo, cada fila con una barra relativa al mayor:

- **Por agente**: el nombre del rol, o "sistema" si la entrada no tiene rol.
- **Por modelo**: `proveedor/slug`.

Cada fila: costo, llamadas y miles de tokens (entrada + salida). No muestra los
tokens servidos desde caché ni la latencia, que el ledger sí guarda. Sin entradas:
"Sin datos todavía." No hay intervalo: para ver una corrida en curso avanzar,
volvé a la pantalla o mirá la cabecera de [[Pantalla Proceso en vivo]].

> [!note] Un turno de suscripción cuesta US$0
> `claude-code` informa costo cero a propósito —la suscripción no factura por
> token— y `opencode` sólo lo informa con `ORQ_OPENCODE_COSTO=1`. Esos turnos
> aparecen con llamadas y tokens pero sin gasto. Ver [[Costos y presupuesto]].

## Mantenimiento

**Dónde:** al pie de `/p/:companyId/empresa`. **Componente:** `Mantenimiento`
(recibe `onCompanyGone`).

Lo que se limpia, no lo que se configura. Va al pie y **arranca cerrado**: son las
únicas acciones de esa pantalla que destruyen trabajo y ninguna es reversible —no
hay papelera ni en el disco ni en la base—. Cerrado muestra una línea que lo dice
y el botón **limpiar…**.

Abierto pide `["mantenimiento"]` → `GET /api/mantenimiento` (sólo abierto: recorre
el disco entero y no tiene por qué correr cada vez que alguien edita un agente):
el peso de la base, las filas sueltas por tabla, las carpetas sin empresa y
cuántas corridas terminadas hay. Con algo que limpiar, el título lleva la marca
**hay residuos**.

| Acción | Alcance | Pedido | Se habilita |
|---|---|---|---|
| **Vaciar la salida** | esta empresa | `POST /api/companies/:id/exports-vaciar` | siempre |
| **Borrar la empresa** | esta empresa | `DELETE /api/companies/:id` | siempre (409 con una corrida en curso) |
| **Corridas terminadas (N)** | todas las empresas | `DELETE /api/runs/terminadas` | con N > 0 |
| **Filas sueltas en la base (N)** | todas | `POST /api/mantenimiento/purgar` con `residuos` y `compactar` | con N > 0 |
| **Carpetas sin empresa (N)** | todas | `POST /api/mantenimiento/purgar` con `carpetas` | con alguna marcada |

Cada fila dice qué hace **y qué se lleva** antes del botón, porque es la pregunta
que uno se hace frente a un botón así. Las filas sueltas se detallan por tabla
("31 filas" no dice qué se va a borrar). Las carpetas se listan con casillas,
cantidad de archivos y peso, con **todas / ninguna**: quedaron de empresas ya
borradas y no se ven desde ningún otro lado, porque todas las pantallas navegan
por empresa.

Cada acción pide una confirmación en una franja amarilla ("¿Borrar todo lo que
generó X? Se conserva lo que subiste vos, incluido el logo.", "¿Purgar N filas…
y compactar la base?"…) con **sí, borrar** y **cancelar**. El resultado queda en
verde ("Se borraron N archivo(s)… Se conservaron M que no generó la empresa.", "La
base pasó de X a Y.") o el error en rojo, y se refrescan el diagnóstico y la lista
de corridas. Mientras una acción corre, las demás se deshabilitan.

Borrar la empresa además invalida `["companies"]` y llama a `onCompanyGone`, que
navega a `/proyectos`: si no la suelta, la pantalla queda cargando un id muerto.
Qué hace cada limpieza por dentro, y por qué el diagnóstico anuncia exactamente lo
que va a borrar: [[Limpieza y mantenimiento]].

## Qué fijan los tests

No hay tests de estas pantallas. Del servidor, `apps/server/src/db.test.ts` fija
los residuos ("anuncia exactamente las filas que va a borrar", "borrar una empresa
no deja residuos", "compactar no rompe la base") y `apps/server/src/exports.test.ts`,
vaciar ("vaciar conserva el logo aunque sea multimedia", "vaciar dos veces no falla
ni borra de más") y las carpetas residuales.

## Fuentes

- `apps/web/src/routes/Settings.tsx` — `Providers`, `providerLabel`, `Costs`,
  `CostTable`, `Mantenimiento`, `detallarResiduos`, `Accion`.
- `apps/web/src/api.ts` — `providers`, `run`, `mantenimiento`, `purgar`,
  `vaciarSalida`, `limpiarCorridasTodas`, `deleteCompany`, `ProviderStatus`,
  `Mantenimiento`, `ResultadoPurga`.
- `apps/server/src/routes.ts` — `/api/providers`, `/api/mantenimiento`,
  `/api/mantenimiento/purgar`, `/api/runs/terminadas`.

## Ver también

- [[Capa LLM y tiers]]
- [[Costos y presupuesto]]
- [[Limpieza y mantenimiento]]
- [[Pantalla Empresa y organigrama]]
