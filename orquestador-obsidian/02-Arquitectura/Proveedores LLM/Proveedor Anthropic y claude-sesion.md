---
tags: [arquitectura, proveedor]
aliases: [anthropic, claude-sesion, Claude (sesión), AnthropicProvider, ClaudeSesionProvider, anthropic.ts, splitSystem, BETA_OAUTH, PRECIOS_CLAUDE, enriquecerConPreciosClaude]
---

# Proveedor Anthropic y claude-sesion

Dos proveedores, una sola clase: `AnthropicProvider`
(`packages/llm/src/adapters/anthropic.ts`) habla con la API de Anthropic por el
SDK oficial (`@anthropic-ai/sdk` 0.68), y `ClaudeSesionProvider` es la misma
clase registrada con otro id (`claude-sesion`) y otra credencial: el token de la
sesión de `ant auth login` en vez de una API key.

Es un `providerId` aparte —y no una opción de `anthropic`— porque **un rol elige
proveedor por id**: separados, le podés dar la sesión a un agente y la API key al
resto, y conviven en el mismo registro.

> [!warning] `claude-sesion` no es la suscripción de claude.ai
> `ant auth login` es un login a la **plataforma de desarrollo**: sigue
> facturando como API contra tu organización. Lo que ahorra es tener una clave
> estática en `.env`, no los tokens. La suscripción Pro/Max se usa con
> [[Proveedor claude-code]].

## Autenticación

| Proveedor | Credencial | Cómo viaja | Se registra si… |
|---|---|---|---|
| `anthropic` | `ANTHROPIC_API_KEY` | `X-Api-Key` | la variable no está vacía |
| `claude-sesion` | `ANTHROPIC_AUTH_TOKEN` (de `ant auth print-credentials --access-token`) | `Authorization: Bearer` **más** `anthropic-beta: oauth-2025-04-20` | `ORQ_CLAUDE_SESION` está prendido (`1`, `true`, `si`, `sí`) |

El constructor elige en este orden (`AnthropicProvider` → `constructor`):

1. Con `authToken`: `new Anthropic({ authToken, defaultHeaders: { "anthropic-beta": BETA_OAUTH } })`.
2. Con `apiKey`: `new Anthropic({ apiKey })`, **sin** el beta de OAuth
   (mandarlo sería declarar un modo de autenticación que no se usa).
3. Sin nada: `new Anthropic()` vacío, que deja al SDK recorrer su cadena. En
   0.68 esa cadena es corta: el constructor lee `ANTHROPIC_API_KEY` y
   `ANTHROPIC_AUTH_TOKEN` del entorno y **nada más** —no hay lectura del perfil
   de `~/.config/anthropic/`—. Se construye vacío a propósito: el día que el SDK
   sume el perfil de `ant`, esta rama lo hereda sin tocar una línea.

Pasar de clave a token no es cambiar un valor: cambian los dos encabezados. Sin
el beta `oauth-2025-04-20`, `/v1/messages` rechaza un token válido. Por eso lo
maneja el adaptador (`BETA_OAUTH`) y no quien configura.

```sh
ant auth login
export ANTHROPIC_AUTH_TOKEN=$(ant auth print-credentials --access-token)
# y en .env: ORQ_CLAUDE_SESION=1
```

> [!danger] Una `ANTHROPIC_API_KEY` vacía rompe la sesión
> El SDK toma como default lo que haya en el entorno aunque le pases la otra
> credencial, y manda **los dos** encabezados si están los dos. Una clave vacía
> gana igual su lugar y autentica en blanco: la sesión no se usa nunca y el error
> es un 401 sin explicación. `.env.example` la trae vacía, así que copiarlo encima
> alcanza para caer acá. Por eso `buildRegistry` borra del entorno una
> `ANTHROPIC_API_KEY` vacía al prender la sesión; vacía tampoco registraba al
> proveedor `anthropic`, así que borrarla no le cuesta nada a nadie.

Tres cosas más de la credencial de sesión:

- **El token vence y no se refresca solo** al pasarlo por variable. Si el rol
  andaba y dejó de autenticar, es volver a exportarlo y reiniciar el servidor.
- **Es de esta máquina**, la que inició sesión. Alcanza para el orquestador, que
  corre local y de un solo usuario; para un servidor el camino soportado sigue
  siendo la API key ([[ADR-001 No usar Claude Agent SDK]]).
- **El diagnóstico dice qué hacer.** `ClaudeSesionProvider.healthCheck` envuelve
  el de la clase base y, si falla, explica de dónde sale el token, que vence, y
  que una `ANTHROPIC_API_KEY` definida gana sobre él. Es el único proveedor cuya
  credencial no está en `.env`, así que mirar ese archivo no lo arregla.

## Catálogo de modelos

`listModels(refresh)` recorre `client.models.list()` (paginado por iteración
asíncrona) y arma un `ModelInfo` por modelo:

| Campo | Valor |
|---|---|
| `slug` | el `id` de la API, **con fecha** (`claude-haiku-4-5-20251001`) |
| `name` | `display_name` |
| `contextLength` | `max_input_tokens` si el SDK lo trae; si no, 0 y lo completa la tabla curada |
| `inputPricePerMTok`, `outputPricePerMTok` | `null` de la API; los completa la tabla curada |
| `supportsTools` | `true` |

El resultado pasa por `enriquecerConPreciosClaude` y queda cacheado en la
instancia hasta un `refresh` (que hace el health check, o `GET
/api/models?refresh=true`). `healthCheck` es exactamente eso: listar con
`refresh` y contar modelos, sin gastar tokens de generación.

### Precios curados

La Models API de Anthropic no publica precios. Sin ellos el ledger contaba
tokens pero no podía valorizarlos: `computeCost` daba 0, `spentUsd` no crecía y
`budgetUsd` no cortaba nunca (medido: 4 llamadas y 33k tokens de entrada con
`spentUsd: 0.0000`). `PRECIOS_CLAUDE` (`packages/llm/src/modelos-claude.ts`)
cierra ese hueco con **precios de lista fechados a agosto de 2026**:

| Prefijo | Entrada US$/MTok | Salida US$/MTok | Mezclado (80/20) | Contexto |
|---|---|---|---|---|
| `claude-haiku-4-5` | 1 | 5 | 1,80 | 200.000 |
| `claude-3-5-haiku` | 0,8 | 4 | 1,44 | 200.000 |
| `claude-sonnet-5` | 3 | 15 | 5,40 | 200.000 |
| `claude-sonnet-4` | 3 | 15 | 5,40 | 200.000 |
| `claude-3-7-sonnet` | 3 | 15 | 5,40 | 200.000 |
| `claude-opus-5` | 5 | 25 | 9,00 | 200.000 |
| `claude-opus-4-5` | 5 | 25 | 9,00 | 200.000 |
| `claude-opus-4` | 15 | 75 | 27,00 | 200.000 |

Reglas de `enriquecerConPreciosClaude`:

- **Compara por prefijo** porque los ids llegan con sufijo de fecha, y **gana el
  prefijo más largo**: `claude-opus-4-5-…` toma la fila de 4.5 y no la genérica
  de `claude-opus-4`.
- **Sólo completa lo que llegó vacío** (precio `null`, contexto 0). Si algún día
  la API publica precios, ganan los de la API sin tocar la función.
- Lo que no es Claude queda intacto.

El costo resultante es una **estimación por precio de lista** (`priced: true`,
`informado: false`), no lo que Anthropic factura. Alcanza para que el tope de
presupuesto funcione. Cuando sale un modelo, se agrega una fila y nada más.

> [!warning] Una versión sin fila propia cae en la de su familia
> La elección es por prefijo: un `claude-opus-4-6`, `4-7` u `4-8` no tiene fila
> y toma la de `claude-opus-4` (15/75), aunque el comentario de la tabla dice
> que la tarifa vieja es sólo de 4.0 y 4.1. Un modelo de una familia nueva sin
> fila (un `claude-haiku-5`) queda sin precio y se valoriza en 0.

## Tiers

Estos dos proveedores no usan las bandas de precio: con precios reales Haiku y
Sonnet caerían los dos en `standard`, y Opus 4 (27 mezclado) quedaría **fuera**
de `smart` (techo 25). Resuelven por el mapa curado
(`TIERS_ESTATICOS["anthropic"]` y `["claude-sesion"]`, idénticos):

| Tier | Prefijos en orden de preferencia |
|---|---|
| `free` | — (no hay; resolver `free` falla) |
| `cheap` | `claude-haiku-4-5` → `claude-3-5-haiku` |
| `standard` | `claude-sonnet-5` → `claude-sonnet-4` |
| `smart` | `claude-opus-5` → `claude-opus-4-5` → `claude-opus-4` |

Gana el primer prefijo presente en el catálogo vivo y, entre snapshots, el slug
más alto. Ese criterio vale entre fechas del mismo modelo; entre versiones
menores no siempre (`claude-opus-4-20250514` ordena por encima de
`claude-opus-4-1-20250805`), pero sólo pesa si faltan las generaciones
preferidas. Ver [[Capa LLM y tiers]].

> [!tip] Si fijás un slug, copialo del catálogo
> `ProviderRegistry.resolveModel` busca el `modelSlug` fijo **exacto** en el
> catálogo para saber su precio. Un alias sin fecha (`claude-opus-5`) lo acepta
> la API, pero si el catálogo lista la versión fechada no hay coincidencia, el
> `modelInfo` queda vacío y **esas llamadas se valorizan en 0**: el presupuesto
> no las ve.

## Traducción de mensajes y tool-calling

El formato de Anthropic difiere del neutro en tres puntos, y `splitSystem` los
traduce:

| Neutro | Anthropic |
|---|---|
| mensajes `system` | se juntan con `\n\n` en **un** bloque de texto fuera del array (`system`) |
| `assistant` con `toolCalls` | bloques `text` + `tool_use` (`id`, `name`, `input`) en el mismo mensaje |
| mensajes `tool` | bloques `tool_result` (`tool_use_id`, `content`) dentro de un mensaje `user`; los consecutivos se **agrupan** en el mismo `user`, como exige la API |
| `user` | `content` como string |

Las herramientas van como `{ name, description, input_schema }`.

### Breakpoints de caché

Se marcan tres `cache_control: { type: "ephemeral" }`:

1. El bloque del **system**: es lo más estable del turno (rol, objetivo,
   memoria) y se repite entero en cada iteración.
2. La **última herramienta** del catálogo: así las definiciones se sirven del
   caché entre iteraciones en vez de reenviarse enteras.
3. El **último bloque del último mensaje**: todo lo anterior queda dentro del
   segmento cacheado y sólo se paga el delta. Si ese mensaje es un string, se
   convierte en un bloque de texto para poder marcarlo.

Es el patrón que documenta Anthropic para loops de herramientas.

### El pedido

`client.messages.create` con `model`, `max_tokens: req.maxOutputTokens ?? 4096`,
`system`, `messages`, `tools`, `stream: true` y el `signal` del motor.

**`temperature` se omite siempre**, aunque el rol la configure: los modelos
Claude actuales (Opus 5, 4.8, 4.7, Sonnet 5) rechazan los parámetros de sampling
con un 400. El comportamiento se guía por prompt.

`webSearch` y `routing` se ignoran: la búsqueda web nativa sólo la usa
OpenRouter, y un rol con `web_search` usa la herramienta.

### El stream

| Evento de la API | Qué hace el adaptador |
|---|---|
| `message_start` | `inputTokens = input_tokens`; `cachedInputTokens = cache_read_input_tokens + cache_creation_input_tokens` |
| `content_block_start` de tipo `tool_use` | abre un bloque por índice con `id` y `name` |
| `content_block_delta` `text_delta` | acumula el texto y emite `text_delta` en vivo |
| `content_block_delta` `input_json_delta` | concatena el JSON de argumentos del bloque |
| `message_delta` | `outputTokens` y `stop_reason` |

Al terminar emite un `tool_call` por bloque (argumentos parseados; si el JSON no
parsea, `{ __raw }`) y el `done` con `modelSlug: req.model`. `stop_reason` se
traduce: `tool_use` → `tool_calls`, `max_tokens` → `length`, `refusal` →
`content_filter`, el resto → `stop`.

## Uso y costo

No hay `reportedCostUsd`: el costo lo estima `computeCost` con el precio de
lista del catálogo enriquecido. Ver [[Costos y presupuesto]].

> [!warning] `inputTokens` no incluye lo cacheado
> El adaptador guarda en `inputTokens` el `input_tokens` de la API, que es la
> entrada **no** servida desde caché, y aparte suma lectura y escritura de caché
> en `cachedInputTokens`. Dos consecuencias: el ⚡% de caché de la cabecera de
> [[Pantalla Proceso en vivo]] (`cachedInputTokens / inputTokens`) puede pasar
> de 100, y la estimación de costo no valoriza los tokens leídos ni escritos en
> caché. `claude-code` y `opencode` sí suman lo cacheado a la entrada ("sin
> sumarlo, un turno de 375k tokens se informa como si fueran 12").

## Errores, cortes y reintentos

- `wrapError` convierte todo en `LlmError("Anthropic: …")`, reintentable si el
  estado HTTP es 429 o ≥500 (incluye el 529 de sobrecarga).
- El SDK reintenta por su cuenta (2 veces por defecto, respetando sus esperas) y
  tiene su propio corte de 10 minutos; el adaptador no los cambia.
- El motor corta cada intento a los 120 s y reintenta hasta 4 veces con 2, 4 y
  8 s de espera. Ver [[Capa LLM y tiers]].

## Variables de entorno

| Variable | Para qué | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | registra `anthropic` | — (vacía no registra, y con la sesión prendida se borra) |
| `ORQ_CLAUDE_SESION` | interruptor de `claude-sesion` | apagado |
| `ANTHROPIC_AUTH_TOKEN` | token OAuth de corta vida para `claude-sesion` | — |

El SDK además respeta `ANTHROPIC_BASE_URL` si está definida; el proyecto no la
usa. `ANTHROPIC_API_KEY` y `ANTHROPIC_AUTH_TOKEN` se **sacan** del entorno del
CLI de `claude-code` (`entornoDelCli`): ver [[Proveedor claude-code]].

## Fallas conocidas

| Síntoma | Causa | Qué hacer |
|---|---|---|
| 401 en `claude-sesion` recién configurado | `ANTHROPIC_API_KEY` definida (gana sobre el token) o token vencido | sacar la clave; reexportar el token y reiniciar |
| 400 en cada turno de un modelo reciente | un parámetro de sampling; el adaptador ya omite `temperature` | no forzarla por otra vía |
| "Ningún modelo de Anthropic califica para el tier free" | el mapa no tiene `free` | asignar `cheap` o más |
| El presupuesto no corta un rol de Claude | slug fijo que no coincide exacto con el catálogo, o modelo sin fila en `PRECIOS_CLAUDE` | fijar el slug fechado o agregar la fila |
| El ⚡% de caché dice 800% | `inputTokens` sin lo cacheado (ver arriba) | es de medición, no de costo real |

## Qué fijan los tests

- `packages/llm/src/registry.test.ts`: la sesión se registra sólo con el
  interruptor y convive con la API key (etiquetas `Claude (sesión)` y
  `Anthropic`); una `ANTHROPIC_API_KEY` vacía se borra del entorno al prender la
  sesión y una con valor no se toca; el token viaja como `authToken` con el beta
  `oauth-2025-04-20` y sin `apiKey`; con API key no se manda el beta.
- `packages/llm/src/modelos-claude.test.ts`: precios y contexto por prefijo con
  slugs fechados, sin pisar lo que vino, con el prefijo más largo ganando
  (Opus 4.5 a 5, Opus 4.1 a 15); el mapa resuelve Haiku/Sonnet/Opus sin bandas,
  toma el snapshot más reciente, cae al prefijo siguiente y deja `free` en
  `null`; con el catálogo enriquecido `computeCost` deja de dar 0.
- `packages/llm/src/adapters/caching.test.ts`: `splitSystem` marca el system,
  el último bloque de la conversación (agrupando dos `tool_result` y marcando
  sólo el último), convierte un último texto plano en bloque cacheado y no toca
  los `assistant` del medio.

## Fuentes

- `packages/llm/src/adapters/anthropic.ts` → `AnthropicProvider`, `ClaudeSesionProvider`, `BETA_OAUTH`, `splitSystem`, `mapStopReason`, `wrapError`
- `packages/llm/src/modelos-claude.ts` → `PRECIOS_CLAUDE`, `enriquecerConPreciosClaude`, `TIERS_ESTATICOS`
- `packages/llm/src/registry.ts` → `buildRegistry` (rama de `ORQ_CLAUDE_SESION`)
- `node_modules/@anthropic-ai/sdk/client.js` → constructor y `authHeaders` (0.68)
- `.env.example` → bloque de Anthropic y de la sesión

## Ver también

- [[Capa LLM y tiers]]
- [[Proveedor claude-code]] — la suscripción de claude.ai, por CLI
- [[Costos y presupuesto]]
- [[ADR-001 No usar Claude Agent SDK]]
- [[Variables de entorno]]
