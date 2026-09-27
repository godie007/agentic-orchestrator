---
tags: [arquitectura, proveedor]
aliases: [openai, nvidia, ollama, OpenAiProvider, NvidiaProvider, OllamaProvider, openai.ts, nvidia.ts, ollama.ts, openai-shared.ts, ToolCallAccumulator]
---

# Proveedores OpenAI, NVIDIA y Ollama

Tres adaptadores del **dialecto OpenAI** que comparten casi todo:
`OpenAiProvider` (`packages/llm/src/adapters/openai.ts`), `NvidiaProvider`
(`nvidia.ts`) y `OllamaProvider` (`ollama.ts`). Los tres usan el SDK `openai` y
las traducciones de `openai-shared.ts`. Lo que los agrupa en una nota es también
su límite común: **ninguno resuelve tiers**, así que un rol que los use tiene que
fijar su `modelSlug`, y **ninguno cuenta dinero** en el ledger.

## Comparación

| | `openai` | `nvidia` | `ollama` |
|---|---|---|---|
| Se registra con | `OPENAI_API_KEY` | `NVIDIA_API_KEY` | `OLLAMA_BASE_URL` (ej. `http://localhost:11434`) |
| Base URL | la del SDK (el `baseUrl` de la config existe pero `buildRegistry` no lo pasa) | `https://integrate.api.nvidia.com/v1` | `<OLLAMA_BASE_URL>/v1`, con `apiKey: "ollama"` (el SDK exige una) |
| Catálogo | `client.models.list()` filtrado a `/^(gpt\|o\d)/i` | `client.models.list()` sin `embed\|reward\|safety\|guard\|rerank\|parse\|ocr` | `fetch` a `<base>/api/tags`; nombre con `parameter_size` |
| `contextLength` | 0 (la API no lo expone) | 0 | 0 |
| Precios | `null` | `null` | 0 y 0 (local) |
| `supportsTools` | `true` | `true` | `true`, **optimista**: depende del modelo |
| Tope de salida | `max_completion_tokens` | `max_tokens` (campo clásico) | `max_tokens` |
| `stream_options.include_usage` | sí | sí | **no**: si el servidor no manda uso, los tokens quedan en 0 |
| `cachedInputTokens` | no se lee | no se lee | no se lee |
| Reintentable | 429 y ≥500 | 429 y ≥500 | **todo** error |
| Etiqueta | `OpenAI` | `NVIDIA` | `Ollama (local)` |

Ninguno marca caché de prefijo ni soporta búsqueda web nativa (un rol con
`web_search` usa la herramienta).

## Por qué no resuelven tiers

Las bandas exigen precio de entrada y de salida, y un contexto mínimo de 32k
(`free`, `cheap`) o 128k (`standard`, `smart`). OpenAI y NVIDIA no publican
precios; Ollama publica 0, pero con contexto 0 no llega a los 32k de `free`, y
fuera de `free` lo gratuito se excluye. Ninguno está en el mapa curado. Ver
[[Capa LLM y tiers]].

> [!danger] Un equipo generado sobre estos proveedores no arranca
> `generarEquipo`, los convocados y los roles aprobados nacen con
> `modelSlug: null` y escalado por tier. Si uno de estos tres es el único
> proveedor configurado, `proveedorPreferido` cae en él y cada turno falla con
> "Ningún modelo de … califica para el tier …"; a los tres ciclos la corrida
> termina `failed`. Fijá un slug por rol desde Empresa.

## Traducción común (`openai-shared.ts`)

- `toOpenAiMessages`: `system`, `user` y `tool` (con `tool_call_id`) pasan
  directo; un `assistant` lleva `content: null` si está vacío y sus `tool_calls`
  como `{ id, type: "function", function: { name, arguments: JSON } }`.
- `toOpenAiTools`: cada `ToolDefinition` como `{ type: "function", function: {
  name, description, parameters } }`.
- `ToolCallAccumulator`: rearma las llamadas que llegan en trozos por `index`;
  descarta fragmentos sin nombre, pone `call_<index>` si falta el `id`, y un JSON
  cortado vuelve como `{ __raw }` para que la herramienta conteste un error
  corregible.
- `mapFinishReason`: `tool_calls`/`function_call` → `tool_calls`; `length`;
  `content_filter`; el resto `stop`.

El `done` lleva `modelSlug: req.model`. `temperature` se manda sólo si el rol la
fijó.

## Costo

OpenAI y NVIDIA sin precio → `computeCost` da 0 con `priced: false`: el ledger
cuenta tokens pero no dinero y **`budgetUsd` no corta**. Ollama da 0 con precio
real 0. En los tres el único freno es `maxTicks`. Para control de gasto fino con
un modelo de OpenAI, usalo por [[Proveedor OpenRouter]]. Ver
[[Costos y presupuesto]].

## Particularidades

**OpenAI.** El filtro del catálogo deja afuera todo lo que no empieza con `gpt`
u `o<dígito>`: un slug fijado que no pase el filtro funciona pero queda sin
`modelInfo`. `OPENAI_API_KEY` también habilita la generación de imágenes
(`packages/tools/src/skills/imagenes.ts`): ver [[Imágenes y medios]].

**NVIDIA.** Con una clave de desarrollador los modelos no cuestan, a cambio de
límites de tasa: esperá 429 en ráfagas y repartí los roles entre modelos
distintos. Medido: `deepseek-v4-flash` devolvía 529 en ráfagas, y algún modelo
que figura en el catálogo (`llama-3.1-nemotron-ultra-253b`) da 404 al llamarlo.
`NVIDIA_API_KEY` también es uno de los proveedores de imágenes.

**Ollama.** Local y sin costo, útil para roles rutinarios. No todos los modelos
locales soportan tool-calling y el catálogo no lo dice: probá el rol con un turno
corto (`npm run check:llm -- --provider=ollama --model=<nombre>`). El catálogo
va por `fetch` **sin corte por tiempo**. Como todo error es reintentable, un
nombre de modelo mal escrito se reintenta cuatro veces antes de fallar.
`healthCheck` falla si el servidor responde pero no tiene modelos descargados.

## Errores y cortes

Cada `wrapError` produce un `LlmError` con el prefijo del proveedor. El SDK
reintenta 2 veces por su cuenta; el motor corta cada intento a los 120 s y
reintenta hasta 4 veces con 2, 4 y 8 s de espera.

## Qué fijan los tests

Ninguno de los tres tiene test propio. Lo compartido con OpenRouter
(`toOpenAiMessages`, a través de `toOpenAiMessagesConCache`) lo cubre
`packages/llm/src/adapters/caching.test.ts`. El `FakeProvider` de los tests del
motor usa `openai` como id por defecto (`packages/engine/src/testing/fake-provider.ts`).

## Fuentes

- `packages/llm/src/adapters/openai.ts` → `OpenAiProvider`
- `packages/llm/src/adapters/nvidia.ts` → `NvidiaProvider`, `BASE_URL`
- `packages/llm/src/adapters/ollama.ts` → `OllamaProvider`
- `packages/llm/src/adapters/openai-shared.ts` → `toOpenAiMessages`, `toOpenAiTools`, `ToolCallAccumulator`, `mapFinishReason`
- `packages/llm/src/registry.ts` → `buildRegistry`

## Ver también

- [[Capa LLM y tiers]] · [[Proveedor OpenRouter]]
- [[Costos y presupuesto]] · [[Variables de entorno]]
- [[Cómo agregar un proveedor LLM]]
