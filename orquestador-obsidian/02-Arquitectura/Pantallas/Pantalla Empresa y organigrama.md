---
tags: [arquitectura, pantalla]
aliases: [Settings.tsx, CompanyDesigner, RoleEditor, Editor de roles, Diseñador de la empresa, AsignacionDeHerramientas, jefeSugerido, OrgGraph.tsx, OrgGraph, radialLayout, tonosPorArea, AgentNode]
---

# Pantalla Empresa y organigrama

Dos piezas que muestran la misma organización:

- **El diseñador** (ruta `/p/:companyId/empresa`, la de entrada a un proyecto):
  `apps/web/src/routes/Settings.tsx` → `CompanyDesigner`. Un editor **por
  formulario** de áreas, agentes y herramientas.
- **El organigrama** vivo: `apps/web/src/routes/OrgGraph.tsx` → `OrgGraph`, que
  se dibuja en el centro de [[Pantalla Proceso en vivo]].

El comentario de `Settings.tsx` explica la división: el organigrama visual ya
existe en Proceso, y duplicarlo como editor de arrastrar y soltar habría costado
mucho más de lo que aporta. La autoridad, la jerarquía y qué habilita cada nivel
están en [[Organización de agentes]].

## El diseñador

Grilla de dos filas: arriba `grid-cols-[280px_1fr]` con **Organización** y el
**editor del agente**; abajo **Mantenimiento**, que se documenta en
[[Pantalla Configuración]]. La fila de arriba lleva `min-h-0`: sin eso el alto
empuja Mantenimiento fuera de la pantalla en vez de hacer scroll.

Datos: el `CompanyBundle` del layout (roles, áreas, herramientas, servidores
MCP), `["models"]` → `GET /api/models` para el selector de modelo, y
`["requests", id]` para avisar cuántas solicitudes pendientes se van con un
agente al borrarlo. Cada cambio invalida `["company", id]`.

### Panel Organización (N)

- **+ departamento** abre un alta en línea (`InlineCreate`: Enter o ✓ crea,
  Escape o × cancela) → `POST /api/companies/:id/departments` con
  `purpose: ""`, `parentId: null`.
- Cada área es un encabezado con dos acciones al pasar el mouse: **+ agente** y
  **×** (borrar). Borrar un área con agentes se frena en el cliente: "Tiene N
  agente(s). Movelos o eliminalos antes de borrar el departamento." (habría que
  decidir a dónde van).
- Debajo, sus agentes: nombre y "cargo · slug o tier". Click → lo abre en el
  editor. Un área vacía dice "Sin agentes."
- Los errores de crear o borrar aparecen en una franja roja arriba de la lista.

**Alta de un agente** (`createRole`): sólo pide el nombre y crea el rol con estos
valores, para editar el resto después:

| Campo | Valor |
|---|---|
| `title` | igual al nombre |
| `systemPrompt` | vacío |
| `model` | copia del `defaultModel` de la empresa (un agente sin modelo no podría correr) |
| `toolIds` | `[]` |
| `authority` | `executor` |
| `reportsTo` | `jefeSugerido(área)` |
| `maxTurns` | 8 |
| `spendApprovalThresholdUsd` | `null` |

`jefeSugerido` decide a quién reporta, en orden: quien ya **dirige** el área
(`manager` o `executive`); si nadie dirige, **el jefe que comparten** sus
compañeros (un QA nuevo entra bajo el jefe de la QA que ya está); y sólo con el
área vacía, el ejecutivo. Colgarlos a todos del CEO armaba una jerarquía plana y
falsa apenas la empresa pasaba de tres roles.

### Editor del agente (`RoleEditor`)

Se monta con `key={role.id}` y trabaja sobre un borrador local. Encabezado
"Nombre — Cargo" con **eliminar** y **guardar** ("guardando…").

| Campo | Control | Detalle |
|---|---|---|
| Nombre, Cargo | texto | |
| Instrucciones del rol | área de texto (7 renglones) | "Se compone con el contexto de la empresa y las políticas que le apliquen." ([[Prompt de un turno]]) |
| Proveedor | selector | sale de `providerIdSchema.options`, no de una lista a mano: la que había se quedó sin `nvidia` y `claude-sesion`. Cambiarlo borra el modelo exacto |
| Tier | `free`, `cheap`, `standard`, `smart` | "Se usa si no fijás un modelo." |
| Autoridad | `executor`, `manager`, `executive` | "ejecuta y escala", "decide en su área", "decide por la empresa" |
| Modelo exacto | modelos del proveedor | con precio de entrada/salida por MTok y "sin tool-calling" si no soporta herramientas; vacío = resolver por tier |
| Escalado por dificultad | casilla "automático" + "de … a …" | deshabilitado con un modelo exacto ("el slug gana siempre"). Al prenderlo arranca en `cheap`–`smart` o en el rango previo |
| Reporta a | cualquier otro rol o "— nadie —" | |
| Iteraciones base por turno | número 1–50 | "Es el piso, no el techo: el motor suma vueltas según la carga del turno" |
| Umbral de aprobación (USD) | número | vacío = sin límite propio |

La UI no valida que el tier mínimo no supere al máximo: el motor invierte el rango
si viene al revés (`packages/engine/src/dificultad.ts`). Ver
[[Escalado por dificultad]] y [[Capa LLM y tiers]].

**guardar** → `PATCH /api/companies/:id/roles/:roleId` con el rol entero. El
servidor lo refleja **en las corridas vivas** (`Runtime.actualizarRolEnCorridasVivas`):
una herramienta otorgada acá le llega al agente en la corrida en curso, no en la
siguiente ([[Runtime del servidor]]).

**eliminar** pide confirmación y avisa "Se borran sus N solicitudes pendientes."
si las tiene. Antes de borrar, el cliente **reasigna a quienes le reportaban** al
jefe del eliminado (un PATCH por cada uno); después `DELETE`, que en el servidor
borra sus solicitudes en cascada y lo saca de las corridas vivas.

> [!warning] El borrador pisa lo que cambió mientras tanto
> El editor copia el rol al abrirse y guarda el objeto entero. Si mientras está
> abierto otro camino le cambia las herramientas —la matriz del Hub, una
> solicitud aprobada, un servidor que otorga al conectar—, **guardar** devuelve
> la lista vieja. Cerrá y abrí el agente antes de editar si pasó algo en el medio.

### Herramientas asignadas (`AsignacionDeHerramientas`)

Una lista plana eran cuarenta casillas seguidas donde una habilidad se veía igual
que el decimoquinto acceso de lectura de un servidor. Ahora:

- Un buscador (nombre o descripción) y el contador `asignadas/total` (el total
  excluye las de coordinación).
- **Grupos**, cada uno con su título, qué significa, `marcadas/total` y un botón
  **todas / ninguna**: Habilidades (`skill`), Capacidades (`capability`), Creadas
  por agentes (`creada`, [[Herramientas compuestas]]), **uno por servidor MCP**
  (mezclarlos dejaba el nombre como única pista de origen) y "Otras herramientas
  MCP" (de un servidor que ya no está).
- Cada herramienta: casilla, nombre sin `mcp__<servidor>__`, la marca **pide
  aprobación** si corresponde, y **escribe** sólo si no es MCP y no es de lectura
  —en MCP `readOnly` sale de una anotación que casi nadie manda, y rotular
  "escribe" a un `read_file` es peor que no decir nada—.
- **Coordinación** al final como chips, no casillas: el motor se las da a todos
  sin mirar `toolIds`, y dibujarlas como quitables sería mentir
  ([[Herramientas y tool router]]).
- Sin herramientas: "No hay herramientas registradas. Conectá un servidor MCP
  desde el Hub."

El contador cuenta todos los `toolIds` del rol, también los que apuntan a algo que
ya no existe: puede dar más que el total.

### Lo que esta pantalla no edita

La misión, el contexto de negocio, el presupuesto, el modelo por defecto y la voz
de la empresa, las **políticas**, las **misiones programadas** y el blueprint no
tienen formulario: se editan por la API (`PATCH /api/companies/:id`,
`/policies`, `/misiones`, `/blueprint`). Ver [[Referencia de API]] y
[[Misiones programadas]]. Posiciones: el organigrama se calcula solo, así que
`position` no se edita en ningún lado.

## El organigrama (`OrgGraph`)

Los nodos son los agentes y pulsan mientras piensan; las aristas son las líneas de
reporte y se animan cuando un mensaje viaja. Recibe `roles`, `departments`, el
`DerivedState` de la traza, las aristas activas, los contadores de bandeja, el rol
seleccionado y `onSelect`.

### Disposición radial (`radialLayout`)

Al centro quien decide, y cada anillo hacia afuera es un escalón de la jerarquía:
la estructura se lee sin seguir una sola arista. Un árbol en filas se iba de
pantalla pasados los seis roles; un anillo crece hacia los costados **y** hacia
arriba.

1. Raíces: los roles sin `reportsTo`, o con un `reportsTo` que apunta a un rol
   borrado o a sí mismo (así el nodo aparece igual).
2. Se cuentan las hojas de cada rama (un ciclo en `reportsTo` corta la cuenta).
3. Con una sola raíz, va al centro (nivel 0); con varias, se reparten en el
   primer anillo.
4. El radio de cada anillo se **acumula**: el primero es `ANCHO_NODO + CLARO` y
   cada siguiente `+ PASO_ANILLO`, pero se abre más si el perímetro no alcanza
   para sus tarjetas (`cantidad × (ANCHO_NODO + 40)`).
5. Cada rama se reparte el ángulo de su padre por la **raíz cuadrada** de sus
   hojas: proporcional puro dejaba el círculo torcido (con 2 hojas contra 1, una
   se llevaba 240°).
6. Se arranca arriba (−90°) y se resta medio nodo a la posición, porque React Flow
   ubica por la esquina y no por el centro.
7. Lo que quedó fuera del recorrido (un ciclo cerrado) se cuelga de un anillo
   exterior en vez de apilarse en el origen.

| Constante | Valor | Por qué |
|---|---|---|
| `ANCHO_NODO` / `ALTO_NODO` | 208 / 96 px | la tarjeta es `w-52` |
| `PASO_ANILLO` | 180 | la altura de una tarjeta más aire |
| `CLARO` | 70 | aire entre el centro y el primer anillo |
| `ACHATADO` | 1,5 | el lienzo es apaisado: una elipse entra más grande que un círculo limitado por el alto, y estira en la dirección en que las tarjetas necesitan lugar |
| `MALLA_MAXIMA` | 28 pares | arriba de esto no se dibujan los canales sin usar: 12 agentes son 66 líneas |

Detrás de todo va un nodo `__anillos` (no seleccionable, `zIndex` 0) con las
elipses punteadas de cada nivel: con cinco agentes, tres puntos sobre una
circunferencia no alcanzan para que el ojo complete el círculo.

> [!note] El organigrama no respeta posiciones manuales
> Las posiciones se calculan siempre desde la jerarquía y los nodos no se pueden
> arrastrar (`nodesDraggable={false}`); `role.position` sólo se usaría si un rol
> quedara sin posición calculada, y eso no pasa. `CLAUDE.md` y
> [[Trampas conocidas]] todavía hablan de un `autoLayout` que "respeta las que
> moviste a mano": ya no existe.

### El nodo de un agente (`AgentNode`)

- Avatar con las **iniciales** (`iniciales`: primera y última palabra, o las dos
  primeras letras) en el tono del área; más grande si es la cima.
- Burbuja de bandeja con los mensajes `pending` que lo esperan (`9+` arriba de
  nueve).
- Nombre y cargo.
- Franja de estado: el punto del área (su `title` es el nombre del área), y
  `⚙ <herramienta>` si está ejecutando, "pensando…" si piensa, "en espera" si ya
  corrió, "sin correr" si no.
- `ModeloBadge` **siempre**, también mientras piensa —es justo cuando importa si
  el turno lo corre Opus o el modelo gratis—; sin traza todavía, el modelo
  configurado del rol ([[Sistema de diseño y temas]]).
- Mientras piensa, la clase `is-thinking` lo hace latir.
- Los anclajes van al centro y sin dibujar: en disposición radial las líneas salen
  en todas las direcciones.

### Las aristas

| Tipo | Id | Cuándo | Cómo se ve |
|---|---|---|---|
| Reporte | `org-<rol>` | cada `reportsTo` | recta, del tono del área de destino; grosor `1.2 + log2(1 + mensajes) × 0.5`; sin flecha (la tapa el nodo; la dirección la da la disposición) |
| Conversación | `charla-<par>` | pares que se escribieron sin ser jefe y reporte | tinta tenue al 30%, grosor por cantidad de mensajes (con logaritmo, o dos que se escribieron treinta veces tapaban todo) |
| Canal | `canal-<par>` | pares que nunca se hablaron, sólo hasta 28 pares | línea sólida finísima al 22%: es posibilidad, no actividad |

Con un mensaje reciente, la arista toma el color del tipo de mensaje
(`MESSAGE_COLOR`) y la clase `edge-active`. Las conversaciones salen de
`state.flows`, así que respetan el corte del timeline.

### Los nodos se actualizan, no se rearman

> [!danger] El organigrama invisible
> React Flow mide cada nodo con un `ResizeObserver` y lo deja en
> `visibility: hidden` hasta tener su tamaño. Si en cada render recibe objetos
> nuevos, pierde la medición y vuelve a empezar: con la traza llegando por SSE y
> la bandeja refrescándose cada 3 s nunca terminaba, y **el organigrama quedaba
> invisible** —nodos en el DOM, ninguno en pantalla—. `OrgGraph` usa
> `useNodesState` y en cada actualización **reusa el nodo anterior** cambiando
> sólo `position` y `data`, así conserva `measured`.

### Encuadre

`fitView` corre una sola vez al inicializar, y dentro de una grilla flexible el
contenedor puede medir cero en ese momento: el lienzo se veía vacío. Por eso un
`ResizeObserver` re-encuadra (`padding: 0.15`) apenas el contenedor tiene tamaño,
y al cambiar la cantidad de roles o la disposición se re-encuadra **dos frames
después** (uno para que el DOM exista, otro para que React Flow haya medido): un
`fitView` sobre nodos sin medir dejaba media empresa fuera de pantalla. Zoom
mínimo 0,25, controles de zoom y fondo de puntos.

Click en un agente → `onSelect`: en Proceso abre su panel.

## Qué fijan los tests

No hay tests de estos componentes. `apps/server/src/roles-vivos.test.ts` fija que
"una herramienta otorgada desde la configuración llega a la corrida en curso" y
que no toca otras empresas; `apps/server/src/db.test.ts`, que borrar un rol se
lleva sus solicitudes y deja las de los demás.

## Fuentes

- `apps/web/src/routes/Settings.tsx` — `CompanyDesigner`, `jefeSugerido`,
  `InlineCreate`, `RoleEditor`, `AsignacionDeHerramientas`, `providerLabel`.
- `apps/web/src/routes/OrgGraph.tsx` — `OrgGraph`, `radialLayout`, `AgentNode`,
  `AnillosNode`, `tonosPorArea`, `iniciales`, constantes.
- `apps/web/src/App.tsx` — `EmpresaRuta`.
- `apps/server/src/routes.ts` — `registerChild` para `roles` y `departments`.
- `packages/engine/src/dificultad.ts` — el rango invertido.

## Ver también

- [[Organización de agentes]]
- [[Pantalla Proceso en vivo]] — donde vive el organigrama
- [[Pantalla Hub MCP]] — la matriz de accesos por servidor
- [[Pantalla Configuración]] — Mantenimiento, al pie de esta pantalla
- [[Catálogo de herramientas]]
