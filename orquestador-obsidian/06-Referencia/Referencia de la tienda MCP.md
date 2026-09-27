---
tags: [referencia, mcp]
aliases: [Artículos de la tienda, CATALOGO_MCP lista]
---

# Referencia de la tienda MCP

Cada artículo de `CATALOGO_MCP` (`packages/shared/src/tienda-mcp.ts`), tal como
está en el código. Cómo funciona la tienda: [[Tienda MCP]]. Todos son `stdio`,
así que la máquina necesita `npx` (Node) o `uvx` (uv) en el `PATH` del servidor.
Las variables se guardan **por nombre**: el valor va en el `.env` del servidor.
Las herramientas se ven como `mcp__<servidor>__<tool>`.

## Archivos y conocimiento

| id | Nombre | Servidor | Comando | Variables | Sugerido por |
|---|---|---|---|---|---|
| `filesystem` | Sistema de archivos | `archivos` | `npx -y @modelcontextprotocol/server-filesystem .` | — | estudio-audiovisual |
| `memory` | Memoria persistente | `memoria` | `npx -y @modelcontextprotocol/server-memory` | — | consultora, estudio-audiovisual, lanzamiento, investigacion |
| `sequential-thinking` | Pensamiento secuencial | `pensamiento` | `npx -y @modelcontextprotocol/server-sequential-thinking` | — | desarrollo-software |
| `time` | Fecha y hora | `tiempo` | `uvx mcp-server-time` | — | — |
| `context7` | Context7 | `context7` | `npx -y @upstash/context7-mcp` | — | desarrollo-software |

- `filesystem` permite **el directorio de trabajo del proceso del servidor** (`.`),
  no la salida de la empresa.
- `time` existe porque los agentes no tienen reloj (la fecha del día ya viaja en
  el prompt; esto agrega hora y husos).

## Desarrollo

| id | Nombre | Servidor | Comando | Variables | Sugerido por |
|---|---|---|---|---|---|
| `git` | Git | `git` | `uvx mcp-server-git` | — | — |
| `github` | GitHub | `github` | `npx -y @modelcontextprotocol/server-github` | `GITHUB_PERSONAL_ACCESS_TOKEN` | desarrollo-software |
| `gitlab` | GitLab | `gitlab` | `npx -y @modelcontextprotocol/server-gitlab` | `GITLAB_PERSONAL_ACCESS_TOKEN` | — |
| `supabase` | Supabase | `supabase` | `npx -y @supabase/mcp-server-supabase@latest` | `SUPABASE_ACCESS_TOKEN` | — |
| `n8n` | n8n | `n8n` | `npx -y n8n-mcp` | `N8N_API_URL`, `N8N_API_KEY` | — |

- `github`, `gitlab` y otros apuntan en `docsUrl` a `servers-archived`: son los
  servidores de referencia archivados; siguen publicados en npm.
- `supabase` es el servidor **local** con token personal. El remoto con
  navegador (OAuth) no está en la tienda: se da de alta pegando su JSON
  ([[OAuth para servidores MCP]]).
- `n8n` marca sus dos variables como obligatorias, pero `n8n-mcp` también trabaja
  sin credenciales (documentación de nodos y validación, sin desplegar): la
  tienda avisa "falta" e instala igual.
- Para el código del proyecto, el orquestador tiene sus propias herramientas
  ([[Herramientas de código]]); `git` es para repos que no están cargados.

## Web y búsqueda

| id | Nombre | Servidor | Comando | Variables | Sugerido por |
|---|---|---|---|---|---|
| `fetch` | Fetch | `fetch` | `uvx mcp-server-fetch` | — | consultora, lanzamiento, investigacion |
| `brave-search` | Brave Search | `brave` | `npx -y @modelcontextprotocol/server-brave-search` | `BRAVE_API_KEY` | — |
| `duckduckgo` | DuckDuckGo | `duckduckgo` | `uvx duckduckgo-mcp-server` | — | investigacion |
| `tavily` | Tavily | `tavily` | `npx -y tavily-mcp` | `TAVILY_API_KEY` | — |
| `firecrawl` | Firecrawl | `firecrawl` | `npx -y firecrawl-mcp` | `FIRECRAWL_API_KEY` | — |
| `exa` | Exa | `exa` | `npx -y exa-mcp-server` | `EXA_API_KEY` | — |
| `youtube-transcript` | Transcripciones de YouTube | `youtube` | `npx -y @kimtaeyoon83/mcp-server-youtube-transcript` | — | — |

- Brave en plan Free acepta **una consulta por segundo**: la fila del servidor y
  sus dos reintentos lo absorben ([[Integración MCP]]).
- Cualquiera de estos da búsqueda web con **cualquier** proveedor de modelo; la
  `web_search` interna sólo funciona con búsqueda nativa del proveedor.

## Navegador

| id | Nombre | Servidor | Comando | Variables | Sugerido por |
|---|---|---|---|---|---|
| `playwright` | Playwright | `playwright` | `npx -y @playwright/mcp@latest` | — | — |
| `puppeteer` | Puppeteer | `puppeteer` | `npx -y @modelcontextprotocol/server-puppeteer` | — | — |

Un navegador es un recurso compartido: por eso la fila por servidor (dos agentes
se pisaban la pestaña). Para filmar, reconocer pantallas antes de grabar se hace
con `explorar_pantalla`, que usa el mismo Chrome que la cámara; Playwright queda
para crear datos de demo y leer consola y red ([[Motor de clips grabados]]).

## Datos

| id | Nombre | Servidor | Comando | Variables | Sugerido por |
|---|---|---|---|---|---|
| `sqlite` | SQLite | `sqlite` | `uvx mcp-server-sqlite --db-path data/mcp-sqlite.db` | — | — |
| `airtable` | Airtable | `airtable` | `npx -y airtable-mcp-server` | `AIRTABLE_API_KEY` | — |
| `stripe` | Stripe | `stripe` | `npx -y @stripe/mcp --tools=all` | `STRIPE_SECRET_KEY` | — |

- La ruta de `sqlite` es relativa al directorio de trabajo del servidor.
- `stripe` con `--tools=all` expone también operaciones que cobran o reembolsan.
  Como la tienda instala con `autoApproveTools: true`, considerá apagarlo por la
  API (`PATCH …/mcp-servers/:id`) para que lo que escribe espere aprobación.

## Productividad y comunicación

| id | Nombre | Servidor | Comando | Variables | Sugerido por |
|---|---|---|---|---|---|
| `slack` | Slack | `slack` | `npx -y @modelcontextprotocol/server-slack` | `SLACK_BOT_TOKEN`, `SLACK_TEAM_ID` | — |
| `notion` | Notion | `notion` | `npx -y @notionhq/notion-mcp-server` | `NOTION_TOKEN` | — |
| `google-maps` | Google Maps | `maps` | `npx -y @modelcontextprotocol/server-google-maps` | `GOOGLE_MAPS_API_KEY` | — |

## Íconos y categorías

Íconos (Lucide): `folder-open`, `brain`, `list-ordered`, `clock`, `git-branch`,
`github`, `gitlab`, `database-zap`, `workflow`, `globe`, `search`, `telescope`,
`flame`, `sparkles`, `book-open`, `youtube`, `app-window`, `chrome`, `database`,
`table`, `credit-card`, `slack`, `notebook-text`, `map-pin`. Categorías:
`archivos` (1), `conocimiento` (5), `desarrollo` (5), `web` (6), `navegador` (2),
`datos` (3), `comunicacion` (1), `productividad` (2).

"Sugerido por" sale de `mcpSugeridos` de cada plantilla
(`packages/shared/src/plantillas.ts`): ver [[Referencia de plantillas de equipo]].

## Fuentes

- `packages/shared/src/tienda-mcp.ts` → `CATALOGO_MCP`
- `packages/shared/src/plantillas.ts` → `PLANTILLAS_EQUIPO[].mcpSugeridos`

## Ver también

- [[Tienda MCP]] · [[CU-10 Instalar un servidor desde la tienda]] · [[Cómo agregar un servidor a la tienda MCP]]
