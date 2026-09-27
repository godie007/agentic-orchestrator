---
tags: [contribuir, llm]
aliases: [Nuevo proveedor, Adaptador LLM, agregar proveedor]
---

# Cómo agregar un proveedor LLM

Un proveedor es un adaptador en `packages/llm/src/adapters/`, un id en Zod y una
rama en `buildRegistry`. **El motor no se toca**: sólo conoce `LlmProvider`
([[ADR-003 Motor desacoplado del servidor]]). Antes de empezar, leé
[[Capa LLM y tiers]].

## 0. Qué clase de proveedor es

| | API con tool-calling | CLI que delega el turno |
|---|---|---|
| Ejemplos | OpenRouter, Anthropic, OpenAI | `claude-code`, `opencode` |
| `chat` devuelve | `text_delta`, `tool_call`, `done` por iteración | un solo `done` con el texto final, sin `tool_calls` |
| Herramientas del org | el motor las ejecuta | llegan por el puente MCP (`req.orgTools`) |
| Declara | — | `delegaElTurno = true`, `timeoutMs`, `timeoutCodigoMs` |

## 1. El `providerId`, primero en Zod

`packages/shared/src/schema.ts` → `providerIdSchema`. Después, lo que el
typecheck te va a pedir o conviene revisar:

- `apps/web/src/routes/Settings.tsx` → `providerLabel` es un `Record` sobre los
  ids: sin la etiqueta nueva, `npm run typecheck` falla.
- `packages/llm/src/modelos-claude.ts` → `TIERS_ESTATICOS`, si el proveedor no
  publica precios o es de una sola familia (ver paso 2).
- `apps/server/src/runtime.ts` → `proveedorPreferido`, si debe ser el elegido
  para los agentes nuevos.

Ver [[ADR-002 Zod como única fuente de verdad]].

## 2. El adaptador

`packages/llm/src/adapters/mi-proveedor.ts` implementa `LlmProvider` y traduce
en su borde entre el formato neutro y el del proveedor.

| Responsabilidad | Cómo |
|---|---|
| `chat` en streaming | emitir `text_delta` en vivo, un `tool_call` por llamada y **siempre** un `done`; `collect` tira si no llega |
| tool-calling | argumentos parseados; JSON cortado como `{ __raw }`, no una excepción |
| `finishReason` | mapear a `stop`/`tool_calls`/`length`/`content_filter` |
| uso | `inputTokens` **con** lo cacheado incluido, `cachedInputTokens`, y `reportedCostUsd` sólo si es lo que de verdad se paga |
| `modelSlug` del `done` | el que respondió, si el proveedor hace fallback |
| `req.signal` | **obligatorio** pasarlo al SDK, `fetch` o proceso: sin eso un proveedor callado cuelga la corrida |
| errores | `LlmError(mensaje, id, retryable)`: `true` para 429 y 5xx, `false` para lo que reintentar no arregla (401, 402, 404) |
| `listModels(refresh)` | cacheado en la instancia; `contextLength`, precios por MTok (o `null`) y `supportsTools` |
| `healthCheck` | sin gastar tokens si se puede; decir qué hacer cuando falla |

> [!tip] Si habla el dialecto OpenAI
> Reusá `openai-shared.ts` (`toOpenAiMessages`, `toOpenAiTools`,
> `ToolCallAccumulator`, `mapFinishReason`), y `toOpenAiMessagesConCache` si el
> proveedor respeta `cache_control`. Ver [[Proveedores OpenAI, NVIDIA y Ollama]].

### Precios, contexto y tiers

- Sin precios publicados: `null`. El modelo no califica por bandas y sólo se usa
  con slug fijo, **salvo** que agregues el proveedor a `TIERS_ESTATICOS`.
  Mejor inalcanzable por tier que elegido a ciegas.
- Contexto desconocido (0) también excluye de las bandas (mínimo 32k/128k).
- Un proveedor sin ningún tier deja inservibles los equipos de plantilla y los
  convocados si es el único configurado: nacen con tier, sin slug.

### Si es un CLI

Copiá los patrones de [[Proveedor claude-code]] y [[Proveedor opencode]], cada
uno pagado con un incidente:

- **Abortar cierra la promesa**: `SIGTERM`, `SIGKILL` a los 5 s, y resolver o
  rechazar. Matar el proceso sin cerrar la promesa colgó una corrida entera.
- **Rescatar lo producido** con un aviso pegado al texto, cuando el CLI se corta.
- **Sólo lectura sobre la salida de la empresa**; producir va por las
  herramientas del org. Exportá la función que arma permisos (`construirArgs`,
  `configDelTurno`) para fijarla con un test.
- **Nada interactivo**: un pedido de permiso deja el proceso esperando para
  siempre. Negá explícito lo que no quieras.
- **Entorno sin claves de API** si el CLI podría facturar por ellas
  (`entornoDelCli`).
- **El relay existente** (`claude-code-relay.mjs`) sirve para cualquier CLI que
  hable MCP por stdio.
- **Un corte propio por encima del trabajo real**, no del tiempo de una API.

> [!danger] Una variable numérica vacía vale cero
> `Number(process.env["X"] ?? 1_200_000)` da `0` si `.env` trae `X=`: `??` no
> cubre el string vacío. Le pasó a `OPENCODE_TIMEOUT_MS`. Usá `|| default` o
> validá, y no dejes la línea vacía en `.env.example`.

## 3. Exportarlo

`packages/llm/src/index.ts`:

```ts
export { MiProveedor, type MiProveedorConfig } from "./adapters/mi-proveedor.js";
```

## 4. Registrarlo

`packages/llm/src/registry.ts`: sumá sus variables a `ProviderEnv` y una rama en
`buildRegistry` que lo construya **sólo** con credencial. Un proveedor sin
credencial no aparece; uno que aparece y falla en la primera corrida es peor. Si
la credencial vive fuera del `.env` (un login de CLI), usá un interruptor con
`esVerdadero`.

> [!warning] El SDK de Anthropic lee el entorno aunque le pases otra credencial
> En 0.68 el constructor toma `ANTHROPIC_API_KEY` y `ANTHROPIC_AUTH_TOKEN` del
> entorno como default y manda los dos encabezados si están los dos; no lee el
> perfil de `ant auth login`. Una clave vacía autentica en blanco. Ver
> [[Proveedor Anthropic y claude-sesion]].

## 5. Variables de entorno

`.env.example` con un comentario de qué pasa si falta, y
[[Variables de entorno]]. El servidor arma el registro al arrancar: hay que
reiniciar.

## 6. Tests

- en `registry.test.ts`: sin credencial no se registra;
- funciones puras exportadas del adaptador (traducción, permisos, lectura de la
  salida), como `caching.test.ts`, `claude-code.test.ts` y `opencode.test.ts`;
- los tests del motor no necesitan tu proveedor: usan `FakeProvider`.

## 7. Verificar

```bash
npm run typecheck && npm test
npm run check:models                             # salud y qué resuelve cada tier
npm run check:llm -- --provider=mi-proveedor --model=<slug>
```

`check:llm` hace una llamada **real** con una herramienta obligatoria: es la
prueba que importa. Fuera de OpenRouter pasale `--model`, porque elige por
bandas. Un CLI que delega nunca muestra `tool_calls` ahí.

## 8. Documentarlo

Una nota en `02-Arquitectura/Proveedores LLM/` y una fila en la tabla de
[[Capa LLM y tiers]].

## Lista de control

- [ ] `providerIdSchema` y `providerLabel` actualizados
- [ ] tool-calling verificado con `check:llm`, no supuesto
- [ ] `req.signal` respetado; un CLI cierra su promesa al abortar
- [ ] `LlmError` con `retryable` correcto
- [ ] `inputTokens` con caché incluida; costo informado sólo si es real
- [ ] tiers: bandas, mapa curado, o documentado que exige slug fijo
- [ ] sin credencial, no aparece
- [ ] `.env.example` sin variables numéricas vacías, y la bóveda actualizada

## Fuentes

- `packages/llm/src/types.ts` → `LlmProvider`, `LlmError`
- `packages/llm/src/registry.ts` → `buildRegistry`, `ProviderEnv`, `esVerdadero`
- `packages/llm/src/modelos-claude.ts` → `TIERS_ESTATICOS`
- `packages/llm/src/adapters/*.ts`
- `apps/web/src/routes/Settings.tsx` → `providerLabel`
- `scripts/check-llm.ts`, `scripts/check-models.ts`

## Ver también

- [[Capa LLM y tiers]] · [[Costos y presupuesto]]
- [[Turnos delegados a un CLI]]
- [[Guía de contribución]]
