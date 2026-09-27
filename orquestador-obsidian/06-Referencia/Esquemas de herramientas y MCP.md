---
tags: [referencia, mcp]
aliases: [toolSchema, toolOriginSchema, mcpTransportSchema, mcpServerSchema, mcpServerHealthSchema, mcpConnectionStatusSchema, articuloDeTiendaSchema, categoriaDeTiendaSchema, parsearConfigMcp, referenciaDe, ComposicionDeTool, Tool, McpServer]
---

# Esquemas de herramientas y MCP

Cómo se describe una herramienta, un servidor MCP, su estado en vivo y un
artículo de la tienda. Convenciones: [[Referencia de esquemas]]. El
comportamiento está en [[Herramientas y tool router]] e [[Integración MCP]].

## `toolOriginSchema`

| Origen | Qué es | ¿Depende de `toolIds`? |
|---|---|---|
| `coordination` | built-in: cómo se hablan los agentes (más `calcular`, `verificar_cifras`, `buscar_en_entregables` y las del vault) | no: se otorgan siempre |
| `capability` | built-in: `web_search`, `fetch_url`, `send_email` | sí |
| `skill` | built-in: produce algo (Word, PDF, video, código, teléfono) | sí |
| `mcp` | descubierta de un servidor MCP | sí |
| `creada` | compuesta por un agente con herramientas existentes | sí |

## `toolSchema`

| Campo | Tipo | Default | Para qué |
|---|---|---|---|
| `id` | `idSchema` | — | `tol_…`. El esquema **no** tiene `companyId`: la tabla `tools` lo guarda en su columna |
| `name` | string 1–128 | — | lo que ve el modelo; las MCP son `mcp__<servidor>__<tool>` |
| `origin` | `ToolOrigin` | — | |
| `description` | string ≤ 2.000 | `""` | |
| `inputSchema` | record | `{}` | JSON Schema de los argumentos, tal como va al modelo. Cerrado con `additionalProperties: false`, el memo de lecturas calcula la huella sólo con lo declarado |
| `mcpServerId` | id, nullable | `null` | servidor de origen si es `mcp` |
| `requiresApproval` | boolean | `false` | no se ejecuta: abre una aprobación y el turno espera |
| `readOnly` | boolean | `false` | sin efectos: el loop las corre en paralelo y el memo las puede recordar |
| `composicion` | objeto, nullable | `null` | sólo para `creada` (abajo) |

### `composicion`

| Campo | Tipo | Default | Para qué |
|---|---|---|---|
| `pasos` | `{tool 1–128, args record = {}}[]`, 1–6 | — | secuencia de herramientas existentes; los huecos `{{parametro}}` de `args` definen el esquema de entrada |
| `creadaPorRoleId` | id, nullable | `null` | quién la armó |

`ComposicionDeTool = NonNullable<Tool["composicion"]>`. Es declarativa a
propósito: no corre código del agente, así que no puede hacer nada que sus
componentes no pudieran. Los frenos (autoridad, sin compuestas de compuestas,
sin pasos con aprobación) viven en `packages/tools/src/compuestas.ts`. Ver
[[Herramientas compuestas]].

Las filas `creada` se persisten con su composición; `ToolRegistry.describe()`
devuelve siempre `composicion: null`, por eso `persistMcpTools` las saltea.

## `mcpTransportSchema`

Unión discriminada por `type`.

| `type` | Campo | Tipo | Default | Para qué |
|---|---|---|---|---|
| `stdio` | `command` | string ≥ 1 | — | ejecutable |
| | `args` | string[] | `[]` | |
| | `envRefs` | `Record<string,string>` | `{}` | variable del proceso → **nombre** de la variable del `.env` que tiene el valor (`{"GITHUB_TOKEN": "GITHUB_TOKEN"}`) |
| | `cwd` | string, nullable | `null` | |
| `http` | `url` | URL | — | |
| | `headerRefs` | `Record<string,string>` | `{}` | cabecera → nombre de variable |
| | `caPath` | string, nullable | `null` | CA que firma el certificado de un servidor local: sirve para **verificar**, no para saltear |

Los secretos nunca se guardan: el valor sale de `process.env` al conectar
(`apps/server/src/env.ts` → `resolveSecret`). Así un blueprint no lleva
credenciales. Ver [[Seguridad]].

## `mcpServerSchema`

| Campo | Tipo | Default | Para qué |
|---|---|---|---|
| `id`, `companyId` | `idSchema` | — | |
| `name` | string 1–64, `^[a-z0-9_-]+$` | — | segmento `<servidor>` de las tools; único por empresa (el alta devuelve 409) |
| `description` | string ≤ 1.000 | `""` | |
| `transport` | `McpTransport` | — | |
| `enabled` | boolean | `true` | |
| `autoApproveTools` | boolean | `true` | apagado, piden aprobación sólo las tools que el servidor **no** declara `annotations.readOnlyHint` |
| `otorgarAlConectar` | id[] | `[]` | roles a los que se otorgan las tools cuando aparezcan (servidores con OAuth); se vacía al otorgar |
| `envRequeridas` | `{ref ≥ 1, descripcion = "", obligatoria = true}[]` | `[]` | credenciales declaradas de antemano: una faltante se dice al instalar, no en el handshake |
| `catalogoId` | string, nullable | `null` | artículo de la tienda del que salió; `null` = pegado a mano |

## `mcpConnectionStatusSchema` y `mcpServerHealthSchema`

Estado vivo, **no persistido**: lo publica `McpBridge` y lo guarda en memoria el
runtime de empresa (`CompanyRuntime.health`). Viaja por `GET /api/mcp/stream`
(evento SSE `mcp`) y `GET /api/companies/:id/mcp/health`.

Estados: `disabled` · `connecting` · `ready` · `error` · `reconnecting`.

| Campo | Tipo | Default | Para qué |
|---|---|---|---|
| `serverId` · `serverName` | string | — | |
| `status` | `McpConnectionStatus` | — | el semáforo del Hub |
| `handshakeMs` | número ≥ 0, nullable | `null` | latencia del handshake |
| `toolCount` | entero ≥ 0 | `0` | tools descubiertas |
| `invocations` · `errors` | entero ≥ 0 | `0` | telemetría acumulada |
| `lastError` | string, nullable | `null` | |
| `lastInvokedAt` · `connectedAt` | timestamp, nullable | `null` | |
| `reconnectAttempts` | entero ≥ 0 | `0` | se resetea al conectar |
| `envFaltantes` | string[] | `[]` | referencias sin valor en el entorno |
| `autorizacion` | string, nullable | `null` | URL para iniciar sesión OAuth; mientras esté, no conecta ni reintenta |

`Runtime.mcpHealth` filtra por los servidores que siguen configurados: el mapa en
memoria conservaba el último estado de uno borrado (el "servidor fantasma").

> [!note] `mcp.status` es otra cosa
> La traza tiene una variante `mcp.status` con parte de estos campos, pero
> ningún emisor la usa: la salud MCP viaja como `McpServerHealth` por su propio
> stream. Ver [[Referencia de eventos]].

## La tienda: `categoriaDeTiendaSchema` y `articuloDeTiendaSchema`

`packages/shared/src/tienda-mcp.ts`. Catálogo curado en el repo, validado **en
CI** (`tienda-mcp.test.ts`), no en runtime.

Categorías: `archivos` · `desarrollo` · `web` · `datos` · `productividad` ·
`navegador` · `comunicacion` · `conocimiento`.

| Campo | Tipo | Default | Para qué |
|---|---|---|---|
| `id` | string 1–64 | — | lo que citan `mcpSugeridos` de las plantillas y `McpServer.catalogoId` |
| `nombre` | string 1–100 | — | |
| `descripcion` | string 1–500 | — | |
| `categoria` | `CategoriaDeTienda` | — | |
| `icono` | string ≥ 1 | — | nombre de ícono Lucide en kebab-case |
| `servidor` | `{name (regex de McpServer), description = "", transport}` | — | lo que se da de alta |
| `envRequeridas` | igual que en `McpServer` | `[]` | |
| `docsUrl` | URL | — | a dónde ir si el paquete se rompe |

`CATALOGO_MCP` trae 25 artículos; `articuloDeTienda(id)` busca por id. Detalle
en [[Referencia de la tienda MCP]] y [[Tienda MCP]].

## El importador de `mcpServers`

`packages/shared/src/mcp-config.ts`. No es Zod: interpreta el JSON que publica
cada servidor en su README.

| Tipo o función | Qué es |
|---|---|
| `ServidorImportado` | `{ name, description, transport: McpTransport }` |
| `ResultadoImportacion` | `{ servidores, avisos: string[] }` — nunca tira; lo que no entiende vuelve como aviso |
| `parsearConfigMcp(texto)` | acepta `{"mcpServers": {…}}` o el mapa a secas; `url` → `http`, `command` → `stdio` |
| `referenciaDe(valor)` | `${VAR}`, `$VAR` o `VAR` en mayúsculas → nombre de variable; cualquier otra cosa se toma como secreto y devuelve `null` |
| `normalizarNombre(crudo)` | minúsculas, sin acentos, `[a-z0-9_-]`, 64 caracteres; si cambió, se avisa |

Ante la duda gana no guardar: un falso negativo cuesta escribir el nombre a
mano; un falso positivo escribe una credencial en la base. Lo usan el Hub y
`solicitar_servidor_mcp`.

## Fuentes

- `packages/shared/src/schema.ts` — `toolOriginSchema`, `toolSchema`, `mcpTransportSchema`, `mcpServerSchema`, `mcpConnectionStatusSchema`, `mcpServerHealthSchema`
- `packages/shared/src/tienda-mcp.ts` — `categoriaDeTiendaSchema`, `articuloDeTiendaSchema`, `CATALOGO_MCP`, `articuloDeTienda`
- `packages/shared/src/mcp-config.ts` — `parsearConfigMcp`, `referenciaDe`, `normalizarNombre`
- `packages/tools/src/registry.ts` — `ToolRegistry.forRole`, `describe`
- `packages/tools/src/mcp/bridge.ts` — `McpBridge`
- `apps/server/src/runtime.ts` — `mcpHealth`, `persistMcpTools`

## Ver también

- [[Referencia de esquemas]]
- [[Integración MCP]]
- [[Herramientas y tool router]]
- [[Catálogo de herramientas]]
- [[OAuth para servidores MCP]]
