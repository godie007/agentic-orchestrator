---
tags: [arquitectura, pantalla]
aliases: [McpHub.tsx, McpHub, Hub MCP, AltaDeServidor, TiendaMinima, ConnectivityGraph, Quién usa qué, Probador de herramientas, Prober]
---

# Pantalla Hub MCP

**Ruta:** `/p/:companyId/mcp`. **Componente:**
`apps/web/src/routes/McpHub.tsx` → `McpHub`.

Los servidores MCP dejan de ser configuración escondida y pasan a ser un objeto
visible: estado en vivo, herramientas descubiertas, qué agente puede usar cuál, y
un probador para verificar una herramienta sin arrancar la empresa. Desde acá
también se **da de alta** un servidor pegando su configuración, se autoriza uno
que pide OAuth y se lo quita. El puente MCP por dentro: [[Integración MCP]].

## Datos

| Fuente | Qué trae | Refresco |
|---|---|---|
| `["mcp-health", companyId]` → `GET /api/companies/:id/mcp/health` | un `McpServerHealth` por servidor | 10 s |
| `["tools", companyId]` → `GET /api/companies/:id/tools` | el catálogo del runtime (levanta los servidores si hace falta) | 10 s |
| `useMcpStream()` → SSE `/api/mcp/stream` | cambios de salud, al instante | en vivo |
| `CompanyBundle` | `mcpServers` (la configuración) y `roles` | al invalidar `["company", id]` |

La salud del REST y la del stream se fusionan por `serverId` —**el stream pisa**—
y después se **filtra por los servidores configurados**: el stream conserva el
último estado de uno ya borrado, y eso se veía como un servidor fantasma en
`ready`, con botón de reconectar y sin forma de sacarlo. El servidor hace el mismo
filtro en `Runtime.mcpHealth`.

## Disposición

`grid-cols-[380px_1fr]`. Izquierda, en dos filas `minmax(0,1fr)`: **Servidores
MCP** y **Quién usa qué** (con `auto`, la lista crecía sin techo y su cabecera
tapaba la tabla de abajo). Derecha: el **catálogo de herramientas** y el
**probador**.

## Servidores MCP

Dos botones que se excluyen: **tienda** (abre la tienda compacta) y **+ pegar
JSON** (abre el alta).

Cada servidor es una fila clickeable —selecciona y filtra el catálogo; otro click
suelta— con:

- el nombre y su estado (`ready`, `connecting`, `reconnecting`, `error`,
  `disabled`);
- cuántas herramientas tiene, la latencia del handshake, cuántas invocaciones,
  los errores (en rojo) y "reintento #N" (en amarillo);
- el comando y sus argumentos, o la URL;
- el último error, en dos renglones.

Debajo, sus acciones:

- **Autorizar** —sólo si la salud trae `autorizacion`—: un enlace que abre en otra
  pestaña el inicio de sesión del servicio (Supabase, Sentry…). La vuelta la
  recibe el servidor del orquestador y el estado nuevo llega solo por SSE. Ver
  [[OAuth para servidores MCP]].
- **reconectar** → `POST /api/companies/:id/mcp/:serverId/reconnect`.
- **quitar** (en rojo, sin confirmación) → `DELETE /api/companies/:id/mcp-servers/:id`.
  El borrado va en cascada: desconecta, borra sus herramientas y poda los
  `toolIds` que apuntaban a ellas. "Sus herramientas dejan de existir para los
  agentes."

Vacío: "Todavía no hay ningún servidor MCP conectado. Tocá «+ servidor» y pegá la
configuración…" (el botón en realidad dice "+ pegar JSON").

La salud también trae `envFaltantes`, `lastInvokedAt` y `connectedAt`, que esta
pantalla no muestra: una credencial faltante se ve recién en el error.

### Alta pegando la configuración (`AltaDeServidor`)

Un campo de texto donde se pega el bloque `{"mcpServers": {…}}` que publica cada
servidor en su README —el mismo que ya está en Claude o en Cursor— o el mapa a
secas. Pedir que se tradujera a mano campo por campo era, en los hechos, la razón
por la que MCP no se usaba.

Mientras escribís, `parsearConfigMcp` (`@orq/shared`) lo lee y muestra los
servidores que encontró con su transporte, y los **avisos** en amarillo. Los
secretos no se importan: se guarda el **nombre** de la variable y un valor literal
se descarta avisando por qué, porque una empresa exportada a JSON no puede llevar
credenciales adentro.

**conectar N servidor(es)** → un `POST /api/companies/:id/mcp-servers` por
servidor, en orden, con `enabled: true`, `autoApproveTools: true`,
`otorgarAlConectar: []`, `envRequeridas: []` y `catalogoId: null`. El servidor
deduplica por nombre (409) y conecta enseguida. Si falla a la mitad, los
anteriores ya quedaron creados.

### Tienda compacta (`TiendaMinima`)

El mismo catálogo de [[Pantalla Tienda]] en una lista: nombre, categoría,
descripción, "falta en .env: X" y **instalar** (o "instalado ✓"). El resultado va
en una línea: "Conectado: <servidor> (N herramientas) — <avisos>", o el error. Un
artículo ya instalado contesta 409 y se lee como error.

## Quién usa qué (`ConnectivityGraph`)

Una matriz agentes × servidores (`table-fixed`: con ancho automático desbordaba
la columna de 380 px y el panel vecino se comía los clics). Cada columna lleva el
estado del servidor como un punto de color; cada celda, cuántas herramientas de
ese servidor tiene el agente, o "·".

**Click en una celda** le da al agente **todas** las herramientas de ese
servidor, o se las quita si ya las tenía todas (con algunas, las completa) →
`PATCH` del rol. Las herramientas MCP se descubren al conectar, así que nadie las
tiene asignadas de entrada: es la operación que se necesita el 90% de las veces, y
hacerla sobre el mapa donde se ve el problema evita buscarla en otra pantalla. El
cambio llega a las corridas vivas igual que desde el editor de roles.

Vacío: "Conectá un servidor MCP para ver el mapa de accesos."

## Herramientas

Las del servidor seleccionado, o todas las MCP. Cada una: nombre sin `mcp__`,
**requiere aprobación** si corresponde, descripción, "usan: …" o, en amarillo,
"sin asignar — ningún agente puede usarla todavía", y **ver schema** con el
`inputSchema` en JSON. Vacío: "No hay herramientas descubiertas. Verificá que el
servidor esté conectado."

## Probar una herramienta (`Prober`)

Selector con las herramientas MCP (la primera por defecto), argumentos en JSON
(la pista lista los campos que declara el esquema) y **ejecutar** →
`POST /api/companies/:id/mcp/probe`. Un JSON inválido se avisa sin mandar nada.
La respuesta va en verde o en rojo.

`Runtime.probeTool` rechaza las de coordinación, las habilidades y las creadas
(necesitan una corrida) y ejecuta el resto **de verdad**, con el primer rol de la
empresa como actor y `runId: "probe"`.

> [!danger] El probador no pide aprobación
> Una herramienta con `requiresApproval` —una migración, una escritura en una
> base— se ejecuta igual desde acá. Es la persona la que aprieta el botón, pero el
> efecto es real.

## Qué fijan los tests

`packages/shared/src/mcp-config.test.ts` (importar el bloque estándar y el mapa a
secas, un secreto literal no se guarda y se avisa, headers como referencias, JSON
inválido como aviso); `apps/server/src/db.test.ts` ("borra las tools del servidor
y poda los toolIds de los roles"); `apps/server/src/mcp-oauth.test.ts`;
`apps/server/src/roles-vivos.test.ts` (una herramienta otorgada llega a la corrida
en curso).

## Fuentes

- `apps/web/src/routes/McpHub.tsx` — `McpHub`, `TiendaMinima`, `AltaDeServidor`,
  `ConnectivityGraph`, `ToolCatalog`, `Prober`.
- `apps/web/src/lib/stream.ts` → `useMcpStream`.
- `packages/shared/src/mcp-config.ts` → `parsearConfigMcp`.
- `apps/server/src/routes.ts` — `mcp/health`, `mcp/:id/reconnect`,
  `mcp-servers`, `mcp/probe`.
- `apps/server/src/runtime.ts` → `probeTool`, `mcpHealth`.

## Ver también

- [[Integración MCP]]
- [[CU-05 Conectar un servidor MCP]]
- [[Pantalla Tienda]]
- [[OAuth para servidores MCP]]
- [[Pantalla Empresa y organigrama]] — asignar herramienta por herramienta
