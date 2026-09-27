---
tags: [operación, referencia]
aliases: [Scripts, npm run, CLI, check:llm, check:models, db:seed, db:estudio, musica:cama, auditar, vault-contexto]
---

# Comandos

Todos los comandos del repo: qué hacen, qué necesitan y qué dejan. Se corren desde
la raíz del monorepo. Los que dicen "carga `.env`" usan `tsx
--env-file-if-exists=.env`; los que no, leen sólo el entorno del shell.

## Tabla completa

| Comando | Dónde vive | Carga `.env` | Qué hace |
|---|---|---|---|
| `npm run dev` | raíz (`concurrently`) | sí | `dev:server` + `dev:web` |
| `npm run dev:server` | `@orq/server` → `tsx watch src/index.ts` | sí | Fastify con recarga |
| `npm run dev:web` | `@orq/web` → `vite` | Vite lee `PORT` del `.env` | UI en `:5173` |
| `npm run start --workspace @orq/server` | `tsx src/index.ts` | sí | servidor **sin** watch |
| `npm run build` | `--workspaces --if-present` | — | sólo `@orq/web` → `vite build` (el servidor no tiene build) |
| `npm run preview --workspace @orq/web` | `vite preview` | — | sirve lo compilado; no es el modo de uso |
| `npm run typecheck` | raíz → `tsc --build` | — | la puerta de calidad |
| `npm test` / `npm run test:watch` | raíz → `vitest run` / `vitest` | no | todos los workspaces |
| `npm run db:migrate` | `@orq/server` → `src/migrate.ts` | sí | aplica el esquema y lista tablas con filas |
| `npm run db:seed` | `@orq/server` → `src/seed.ts` | sí | Codytion S.A. |
| `npm run db:estudio` | `scripts/seed-estudio-codytion.ts` | sí | el estudio audiovisual (6 roles) |
| `npm run db:inspia` | `scripts/seed-inspia-lanzamiento.ts` | sí | INSPIA — Lanzamiento |
| `npm run db:inspia-publicidad` | `scripts/seed-inspia-publicidad.ts` | sí | INSPIA — Publicidad |
| `npm run db:observatorio` | `scripts/seed-observatorio-ia.ts` | sí | Observatorio de IA |
| `npm run musica:cama` | `scripts/generar-cama.ts` | sí | sintetiza dos camas musicales |
| `npm run check:llm` | `scripts/check-llm.ts` | sí | una llamada real con tool-calling por proveedor |
| `npm run check:models` | `scripts/check-models.ts` | sí | salud y resolución de cada tier con precio |
| `npm run auditar -- --run=<id>` | `scripts/auditar-corrida.ts` | **no** | auditoría de una corrida persistida |
| `npx tsx scripts/vault-contexto.ts <companyId>` | sin script npm | **no** | vuelca la memoria al vault de Obsidian |
| `bash scripts/start.sh` | sin script npm | sí (vía npm) | `db:migrate` + `db:seed` + `dev` |

## Desarrollo

```bash
npm run dev                              # lo de todos los días
npm run dev:web & npm run start -w @orq/server   # corrida larga mientras editás el repo
```

`tsx watch` reinicia el servidor al tocar cualquier archivo importado y eso corta
las corridas vivas ("Servidor detenido."). Ver [[Instalación y arranque]].

## Calidad

```bash
npm run typecheck                                   # tsc --build, referencias de proyecto
npm test                                            # vitest run
npx vitest run packages/engine/src/memory.test.ts   # un archivo
npx vitest run -t "cada mensaje queda atribuido"    # un caso por nombre
```

`typecheck` escribe declaraciones (`.d.ts`) y `.tsbuildinfo` en `dist/` de cada
paquete y en `apps/web/dist-types/`, todo ignorado por git. No hay linter. Ver
[[Pruebas y calidad]].

## Base de datos

```bash
npm run db:migrate
```

Imprime `Base: <ruta>`, `Esquema aplicado — N tablas.` y las filas por tabla; si
está todo en cero, sugiere un seed. No hay migraciones versionadas: el esquema es
idempotente y el constructor de `Store` lo aplica en cada arranque. Sirve para
crear o inspeccionar una base (por ejemplo, apuntando `DATABASE_URL` a otra) sin
levantar el servidor. Ver [[Base de datos]].

## Seeds

Cada seed da de alta **una empresa nueva** con ids nuevos: correrlo dos veces deja
dos empresas con el mismo nombre. `scripts/start.sh` corre `db:seed` en cada
arranque, así que suma una Codytion S.A. por vez.

| Comando | Necesita | Deja |
|---|---|---|
| `db:seed` | nada (los MCP usan `npx` la primera vez que conectan) | empresa, 6 departamentos, 7 roles, 3 políticas, catálogo de capacidades y habilidades, 2 MCP; crea `data/workspace/` |
| `db:estudio` | Chrome en la máquina para que el catálogo tenga las habilidades del motor estudio | 6 roles, 5 políticas. `ORQ_SEED_TIER`, `ORQ_SEED_PROVEEDOR`, `ORQ_SEED_MODELO` |
| `db:inspia` | `ORQ_CLAUDE_SESION` prendido para poder correrla (slugs fijos de Claude) | 4 roles, 3 políticas |
| `db:inspia-publicidad` | `ORQ_CLAUDE_CODE`, Chrome, `OBSIDIAN_BEARER` y el plugin Local REST API | 6 roles, 4 políticas, 2 MCP, 6 lecciones; imprime el `curl` que conecta los MCP |
| `db:observatorio` | `ORQ_CLAUDE_CODE`, **el servidor levantado** en `ORQ_API` y la extensión Browser MCP en Chrome | 5 roles, 4 políticas, 1 MCP; asigna por `PATCH` las herramientas del navegador |

Detalle de cada empresa en [[Empresas de ejemplo]].

## Verificación de proveedores

```bash
npm run check:models                     # healthCheck + tiers de cada proveedor
npm run check:llm                        # llamada real, modelo del tier cheap
npm run check:llm -- --provider=openai   # uno solo
npm run check:llm -- --model=<slug>      # un slug puntual
```

- **`check:models`** llama `healthCheck()` y `resolverTodosLosTiers`: imprime, por
  tier, el slug, los precios de entrada/salida/mezclado y el `reason` de la
  elección, o `sin candidatos`. El health check de OpenRouter y Anthropic sólo
  **lista modelos**: una cuenta sin crédito pasa igual. El de `claude-code` y
  `opencode` corre **un turno real** ("Respondé únicamente con la palabra: ok").
- **`check:llm`** manda "¿Cuánto es 137 por 24?" con una herramienta `calculate`
  obligatoria, `maxOutputTokens: 512`, e imprime respuesta, tool calls, tokens,
  latencia y costo. **Es el que detecta el 402** de una cuenta sin saldo. Sale con
  código 1 si algún proveedor falla.

> [!warning] `check:llm` no sirve para los proveedores que delegan
> Resuelve el modelo con `resolveTier` por bandas de precio, y `claude-code` y
> `opencode` no publican precios: falla con "No se pudo resolver un modelo del
> tier 'cheap'; pasá --model=<slug>". Con `--model` corre, pero como el CLI hace
> su propio loop avisa "el modelo no llamó ninguna herramienta". Para ellos usá
> `check:models`.

## Producción audiovisual

```bash
npm run musica:cama
```

Sintetiza con ffmpeg (necesita `libmp3lame`) dos camas en `MUSICA_DIR`:
`corporativo-calmo.mp3` (La menor, 4 acordes × 8 s = 32 s, quieta) e
`inspirador-crecimiento.mp3` (Do mayor, 4 × 6 s = 24 s, con pulso de 1,7 Hz en la
nota grave). Se normalizan a −24 LUFS al generarse; el video las vuelve a
normalizar a −26 al mezclar. El guion las pide por nombre: `musica: "corporativo"`
o `"inspirador"`. Ver [[Música y narración]].

## Auditoría y memoria

```bash
npm run auditar -- --run=<runId> [--db=<ruta>]
npx tsx scripts/vault-contexto.ts <companyId>
```

- **`auditar`** abre la base en sólo lectura, trae los eventos de la corrida y
  corre `auditarCorrida`: hallazgos por severidad (🔴 alta, 🟡 media, 🔵 info) con
  tick y rol, y métricas de llamadas y fallidas por rol. **No carga `.env`**: si
  tu base no está en `./data/orquestador.db`, pasá `--db=`. Ver
  [[Auditoría de corridas]].
- **`vault-contexto`** escribe una nota por tema de las lecciones de la empresa y
  un `00 - Índice` en `CONTEXTO_DIR`. Tampoco carga `.env`. Ver
  [[Vault de contexto]].

## Diagnóstico rápido

```bash
lsof -ti:3001 | xargs kill -9                    # proceso viejo tomando el puerto
curl -s localhost:3001/api/health                # ¿el servidor está arriba?
ffmpeg -hide_banner -filters | grep -w ass       # ¿ffmpeg tiene libass?
adb mdns services                                # ¿adb ve el teléfono por mDNS?
adb kill-server                                  # reinicia el servidor de adb
```

El porqué de cada uno en [[Diagnóstico de problemas]].

## Fuentes

- `package.json` (raíz), `apps/server/package.json`, `apps/web/package.json`
- `scripts/check-llm.ts`, `scripts/check-models.ts`, `scripts/generar-cama.ts`,
  `scripts/auditar-corrida.ts`, `scripts/vault-contexto.ts`, `scripts/start.sh`,
  `scripts/seed-*.ts`
- `apps/server/src/migrate.ts`, `apps/server/src/seed.ts`
- `packages/llm/src/tiers.ts` → `resolveTier`; `packages/llm/src/modelos-claude.ts` → `resolverTodosLosTiers`

## Ver también

- [[Instalación y arranque]] · [[Pruebas y calidad]] · [[Base de datos]]
- [[Empresas de ejemplo]] · [[Diagnóstico de problemas]]
