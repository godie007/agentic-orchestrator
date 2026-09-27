---
tags: [arquitectura, proveedor]
aliases: [openrouter, OpenRouterProvider, openrouter.ts, toOpenAiMessagesConCache, require_parameters, plugin web, ruteo de OpenRouter]
---

# Proveedor OpenRouter

`OpenRouterProvider` (`packages/llm/src/adapters/openrouter.ts`) usa el SDK de
OpenAI (`openai` 6.x) contra `https://openrouter.ai/api/v1`. Con **una sola
clave** da acceso a cientos de modelos de todos los proveedores, y eso es lo que
permite darle a cada agente el modelo que su trabajo justifica.

Es el único proveedor que:

- resuelve los tiers por **bandas de precio** contra un catálogo vivo y
  heterogéneo ([[Capa LLM y tiers]]);
- **informa el costo real** de cada llamada (`reportedCostUsd`);
- tiene **búsqueda web nativa** (el plugin `web`).

## Autenticación

| Variable | Para qué |
|---|---|
| `OPENROUTER_API_KEY` | registra el proveedor; viaja como `Authorization: Bearer` |
| `APP_URL` | encabezado `HTTP-Referer` (atribución en el ranking público de OpenRouter; sin efecto funcional). El servidor usa la misma variable para los enlaces de los avisos y el CORS |
| `APP_TITLE` | encabezado `X-Title`, idem |

## Catálogo

`listModels` hace `fetch` a `GET /models` con la clave y convierte cada modelo:

| Campo | De dónde |
|---|---|
| `slug` | `id` (`deepseek/deepseek-v4-pro`, `anthropic/claude-sonnet-5`) |
| `name` | `name` |
| `contextLength` | `context_length` |
| `inputPricePerMTok`, `outputPricePerMTok` | `pricing.prompt` y `pricing.completion`, que vienen en USD **por token** como string: se multiplican por 1.000.000 |
| `supportsTools` | `supported_parameters` incluye `"tools"` |

Se cachea en la instancia hasta un `refresh`. Un HTTP que no es 2xx tira
`LlmError` reintentable sólo si es ≥500. El `fetch` **no tiene corte por tiempo**
propio.

`healthCheck` es listar con `refresh`: confirma que la API responde, **no** que
la cuenta tenga crédito. Una cuenta sin saldo pasa el health check y recibe 402 en
el primer turno. Para eso está `npm run check:llm`, que hace una llamada real.

## Tiers

Por bandas (`resolveTier`), sin mapa curado. Vale todo lo de
[[Capa LLM y tiers]]: `free` = precio exactamente 0; `cheap` (0, 1]; `standard`
(1, 8]; `smart` (8, 25] US$/MTok mezclado; contexto mínimo 32k o 128k; y el
desempate de `QUALITY_HINTS`. Dos patrones apuntan justo a este catálogo:
`:free$` (−10 fuera del tier `free`) y `[-:]fast$` (−6).

## El pedido

`client.chat.completions.create` con:

| Campo | Valor | Por qué |
|---|---|---|
| `messages` | `toOpenAiMessagesConCache(req.messages)` | breakpoints de caché, ver abajo |
| `tools` | `toOpenAiTools(req.tools)` (`type: "function"`) | |
| `temperature` | sólo si el rol la fijó | |
| `max_tokens` | `req.maxOutputTokens` | |
| `stream`, `stream_options.include_usage` | `true` | el uso llega en el último trozo |
| `usage: { include: true }` | | devuelve el **costo real** y cuánto salió del caché, también en streaming |
| `provider: { sort, require_parameters: true }` | `sort` = `req.routing?.sort ?? "price"` | ver "Ruteo" |
| `plugins: [{ id: "web", max_results }]` | sólo con `webSearch.enabled` | búsqueda nativa |

`usage`, `provider` y `plugins` son extensiones de OpenRouter que no están en los
tipos del SDK: el cuerpo va con un `as never` y la respuesta se reafirma como
iterable.

### Ruteo entre upstreams

OpenRouter sirve un mismo modelo desde muchos upstreams —18 para
`deepseek-v4-pro`— con hasta 4× de diferencia de precio, y reparte las llamadas
entre ellos. Eso tiene dos consecuencias que decidieron el diseño:

1. **El caché de prefijo sólo pega si dos llamadas seguidas caen en el mismo
   upstream.** Con ruteo libre casi nunca pasa: el prefijo está cacheado en otra
   máquina. `sort: "price"` da un **orden determinista**, así las iteraciones de
   un turno caen en el mismo lugar. No se fija un upstream por nombre: se fija el
   criterio de orden. `ChatRequest.routing` admite `throughput` y `latency`, pero
   el motor no lo pasa nunca, así que siempre es `price`.
2. **`require_parameters: true` es obligatorio junto al orden por precio.** Sin
   él, el ruteo puede caer en un endpoint que ignora `tools`, y el agente deja de
   llamar herramientas **en silencio**: no falla, simplemente no hace nada.

### Caché de prefijo

`toOpenAiMessagesConCache` (`packages/llm/src/adapters/openai-shared.ts`) marca
con `cache_control: { type: "ephemeral" }` el mensaje **system** y el **último
mensaje**, convirtiendo su contenido en un bloque de texto; los del medio quedan
con `content` plano (el `assistant` conserva sus `tool_calls`). OpenRouter traduce
esas marcas al mecanismo de cada proveedor final. Van **por bloque** porque es el
único camino que funciona en todos: el `cache_control` a nivel del pedido excluye
a los que no son Anthropic. Sin ninguna marca se midieron 999.718 tokens
reenviados sin uno solo cacheado.

## El stream

| Qué llega | Qué hace |
|---|---|
| `chunk.model` | actualiza el `modelSlug` del `done`: OpenRouter puede responder con otro modelo (fallback) |
| `chunk.usage` | `inputTokens = prompt_tokens`, `outputTokens = completion_tokens`, `cachedInputTokens = prompt_tokens_details.cached_tokens`, `reportedCostUsd = cost` |
| `delta.content` | acumula y emite `text_delta` |
| `delta.tool_calls` | `ToolCallAccumulator` |
| `finish_reason` | `mapFinishReason` |

`ToolCallAccumulator` (compartido con los otros adaptadores del dialecto OpenAI)
rearma las llamadas que llegan en trozos: el `id` y el nombre en uno, los
argumentos repartidos en los siguientes, todos con el mismo `index`. Al cerrar
descarta los fragmentos sin nombre, pone `call_<index>` si no vino `id` y, si el
JSON quedó cortado, devuelve `{ __raw }` para que la herramienta le conteste al
agente un error corregible en vez de romper el turno. `mapFinishReason`:
`tool_calls`/`function_call` → `tool_calls`, `length`, `content_filter`, el resto
`stop`.

## Costo

Es el único proveedor cuyo costo es **lo que se pagó** y no una estimación. El
precio del catálogo es el del endpoint **más barato** del modelo, y el ruteo no
lo respeta. Medido sobre `deepseek-v4-pro`: catálogo US$0,435/MTok, endpoints
reales entre 0,435 y 1,740. Una llamada que el catálogo valuaba en US$0,017 costó
US$0,068: estimando, el presupuesto llegaba tarde. `computeCost` usa
`reportedCostUsd` cuando viene (aunque sea 0) y sólo si falta cae en el precio del
catálogo. Ver [[Costos y presupuesto]].

## Búsqueda web nativa

El motor la prende cuando el rol tiene la herramienta `web_search`
(`WEB_SEARCH_TOOL_NAME`) **y** el proveedor es `openrouter`
(`packages/engine/src/loop.ts` → `nativeWebSearch`): manda
`webSearch: { enabled: true, maxResults: 5 }`, **retira** `web_search` de las
herramientas expuestas (si no, el modelo llamaría a una que devuelve error) y lo
dice en el evento `tool.selection`. El plugin usa la búsqueda nativa del modelo
donde existe y cae a Exa donde no.

> [!warning] La búsqueda web factura aparte
> Medido con la cuenta sin créditos: el plugin `web` devuelve 402 aunque el modelo
> sea `:free`. Sin saldo, investigar queda en herramientas que corren local
> (`fetch_url`).

## Errores y reintentos

`wrapError` convierte todo en `LlmError("OpenRouter: …")`, reintentable con 429 y
≥500. **Un 402 no se reintenta**: el turno falla en el acto y, si todos los
turnos fallan tres ciclos seguidos, la corrida termina `failed`
([[Scheduler y ciclo de una corrida]]). El SDK de OpenAI reintenta por su cuenta
(2 veces) antes de que el adaptador vea el error, y el motor corta cada intento a
los 120 s.

> [!danger] Saldo negativo: 402 a todo, incluidos los gratuitos
> Medido: corridas con un modelo `:free` **cobraron uso real** (US$0,29 en un
> día) y, cuando el saldo de la cuenta quedó en negativo, OpenRouter respondió
> `402 Insufficient credits` a **toda** llamada, también a las gratuitas. No hay
> nada que optimizar del lado del orquestador: la única salida es cargar
> crédito. Corré `npm run check:llm` antes de una corrida larga.

> [!warning] Un solo modelo `:free` para todos los roles choca contra el límite del upstream
> Medido: con concurrencia 4 y el mismo modelo gratuito en todos los roles, el
> upstream contestaba "Worker local total request limit reached". Repartir los
> roles entre modelos gratuitos distintos, o bajar `AGENT_CONCURRENCY`.

## Fallas conocidas

| Síntoma | Causa |
|---|---|
| El health check da ok pero cada turno recibe 402 | cuenta sin crédito: `/models` no lo detecta |
| El agente deja de llamar herramientas, sin error | un endpoint que ignora `tools`; lo evita `require_parameters: true` |
| Relación entrada/salida muy alta con caché bajo (42:1) | el ruteo: llamadas del mismo turno en upstreams distintos |
| La traza atribuye el turno a otro modelo | fallback de OpenRouter: el `done` trae el que respondió |
| 429 en ráfagas con modelos `:free` | límites agresivos de los gratuitos; el motor reintenta con backoff |

## Qué fijan los tests

No hay un test propio del adaptador (llamaría a la red). Lo que se fija está en
las piezas que usa:

- `packages/llm/src/ledger.test.ts`: con el modelo real de este catálogo
  (`deepseek/deepseek-v4-pro`, 0,435/0,87), el costo informado (US$0,068058) gana
  sobre la estimación (US$0,01719) y la brecha es mayor a 3×; un informado de 0
  con caché es 0; el presupuesto corta con el costo real.
- `packages/llm/src/adapters/caching.test.ts`: `toOpenAiMessagesConCache` marca
  el system y el último mensaje, y deja plano el medio con los `tool_calls`.

## Fuentes

- `packages/llm/src/adapters/openrouter.ts` → `OpenRouterProvider`, `BASE_URL`, `toModelInfo`, `wrapError`
- `packages/llm/src/adapters/openai-shared.ts` → `toOpenAiMessagesConCache`, `toOpenAiTools`, `mapFinishReason`, `ToolCallAccumulator`, `parseArguments`
- `packages/llm/src/types.ts` → `RoutingPreference`, `TokenUsage.reportedCostUsd`
- `packages/llm/src/ledger.ts` → `computeCost`
- `packages/engine/src/loop.ts` → `nativeWebSearch`

## Ver también

- [[Capa LLM y tiers]] · [[ADR-004 Bandas de precio disjuntas]]
- [[Costos y presupuesto]]
- [[Proveedores OpenAI, NVIDIA y Ollama]] — los otros del dialecto OpenAI
- [[Herramientas y tool router]]
