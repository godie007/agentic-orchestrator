---
tags: [operación, servidor]
aliases: [DB, SQLite operación, db:migrate, db:seed, orquestador.db, Respaldo de la base]
---

# Base de datos

Lo operativo de la base: dónde vive, cómo se crea, se inspecciona, se respalda,
se compacta y se siembra. El esquema técnico (tablas, columnas, índices,
cascadas) está en [[Persistencia y esquema SQL]].

## Dónde vive

| Archivo | Qué es |
|---|---|
| `data/orquestador.db` | La base. `DATABASE_URL` la cambia; una ruta relativa se ancla a la **raíz del monorepo** (`env.ts` → `fromRoot`), no al directorio actual |
| `data/orquestador.db-wal` y `-shm` | El diario de escritura (modo WAL) y su índice compartido. Normales mientras el servidor corre |
| `data/mcp-oauth/` | Tokens OAuth de los servidores MCP, `0600`. Viven en `dirname(DATABASE_URL)`: si movés la base, se mueven con ella. **Son secretos** |
| `data/` | Entera en `.gitignore`, igual que `*.db`, `*.db-wal`, `*.db-shm` |

Lo que no está en la base —salida, repos, vault, música— vive en
`data/proyectos/`, `data/contexto/` y `data/musica/` (ver
[[Directorios en disco]]).

## Crear y migrar

No hay migraciones versionadas. El constructor de `Store` aplica el esquema
—`CREATE … IF NOT EXISTS`, idempotente— cada vez que alguien abre la base, así
que arrancar el servidor con una base vacía la crea (y crea `data/` si falta).

```bash
npm run db:migrate   # aplica el esquema y lista cada tabla con sus filas
```

`apps/server/src/migrate.ts` abre el `Store`, imprime la ruta, "Esquema aplicado
— 18 tablas" y la cuenta de filas de cada una, y si está vacía sugiere
`db:seed`. Sirve para crear o verificar una base **sin levantar el servidor ni
sembrar**: al clonar el repo, al apuntar `DATABASE_URL` a otro archivo, o para
confirmar que una base vieja tiene todas las tablas.

> [!warning] Una migración de verdad va en el constructor del `Store`
> El servidor no corre `migrate.ts` al levantar: una migración que viva sólo ahí
> no se aplica con `npm run dev`. La única que existe,
> `migrarArtefactosAEmpresa` (agrega `artifacts.company_id`), está en el
> constructor, idempotente y barata porque corre en cada arranque.

## Sembrar

| Comando | Crea |
|---|---|
| `npm run db:seed` | "Codytion S.A.": 6 departamentos, 7 roles, 3 políticas, 2 servidores MCP (`archivos` sobre `data/workspace` y `memoria`), y todas las herramientas `capability` y `skill` en `tools`. Todo en `openrouter` por tier |
| `npm run db:estudio` | El estudio audiovisual (`scripts/seed-estudio-codytion.ts`). Tier `free` por defecto; `ORQ_SEED_TIER`, `ORQ_SEED_PROVEEDOR`, `ORQ_SEED_MODELO` y `ORQ_CLAUDE_CODE` lo cambian |
| `npm run db:inspia` | El estudio de lanzamiento de INSPIA |
| `npm run db:inspia-publicidad` | La productora de clips sobre la app real |
| `npm run db:observatorio` | El observatorio de IA; al final le pega al servidor (`ORQ_API`, por defecto `http://localhost:3001`) para conectar MCP y asignar sus tools |

Ver [[Empresas de ejemplo]].

> [!danger] Ningún seed es idempotente
> Todos crean la empresa con ids nuevos: correr uno dos veces deja **dos**
> empresas iguales. `scripts/start.sh` corre `db:migrate` y `db:seed` en cada
> arranque, así que cada uso suma otra "Codytion S.A.". Una de más se borra
> desde la pantalla de Proyectos.

> [!note] Sembrar con el servidor andando
> Se puede (WAL admite un escritor por vez; `better-sqlite3` espera hasta 5 s
> antes de `SQLITE_BUSY`), pero el servidor no se entera solo de los MCP de la
> empresa nueva: `GET /api/companies/<id>/tools` levanta su runtime, conecta y
> descubre. Es lo que imprime al final `db:inspia-publicidad`.

> [!warning] Al armar una empresa por código, registrá las habilidades
> `forRole` sólo regala las de coordinación: una habilidad que no está en
> `tools` y en `role.toolIds` no existe para el agente, que termina explicando
> que no encuentra `export_video`. `db:seed` hoy siembra `capability` **y**
> `skill`; una empresa creada por la API las siembra sola
> (`Runtime.sembrarHerramientas`).

## Inspeccionar

Siempre en **sólo lectura** si el servidor está andando:

```bash
sqlite3 -readonly data/orquestador.db ".tables"
sqlite3 -readonly data/orquestador.db "SELECT id, json_extract(data,'$.name') FROM companies;"
sqlite3 -readonly data/orquestador.db "SELECT id, json_extract(data,'$.status'), json_extract(data,'$.spentUsd') FROM runs ORDER BY started_at DESC LIMIT 5;"
sqlite3 -readonly data/orquestador.db "SELECT json_extract(data,'$.key'), json_extract(data,'$.version') FROM artifacts WHERE company_id='<id>';"
sqlite3 -readonly data/orquestador.db "SELECT seq, type FROM events WHERE run_id='<id>' ORDER BY seq;"
```

Casi todo está en la columna `data` (JSON): se consulta con `json_extract`. Las
columnas sueltas son sólo las de filtro (`company_id`, `run_id`, `started_at`,
`tick`, `type`…). `seq` es lo que da el orden del replay.

Qué pesa y cuánto se recuperaría compactando:

```bash
sqlite3 -readonly data/orquestador.db "SELECT name, SUM(pgsize) FROM dbstat GROUP BY name ORDER BY 2 DESC LIMIT 8;"
sqlite3 -readonly data/orquestador.db "PRAGMA page_size; PRAGMA page_count; PRAGMA freelist_count;"
```

Medido en la base de esta máquina el 26/09/2026: 3 761 páginas de 4 KiB
(~15 MB), de las que **1 227 estaban libres** (~5 MB que un `VACUUM`
devolvería); `events` ocupaba ~5,8 MB con 7 792 filas, casi el doble que todos
los entregables juntos. La traza es lo que más crece.

Otras vías:

- `GET /api/mantenimiento`: peso, residuos por tabla y carpetas sin empresa, sin
  borrar nada (ver [[Referencia de API]]).
- `npm run auditar -- --run=<runId> [--db=<ruta>]`: audita el proceso de una
  corrida leyendo su traza (abre la base en sólo lectura). Ver
  [[Auditoría de corridas]].
- `npx tsx scripts/vault-contexto.ts <companyId>`: vuelca la memoria de la base
  al vault (lee `learnings` en sólo lectura).

## Los archivos WAL

Con `journal_mode = WAL` las escrituras van primero al `-wal` y SQLite las pasa
al archivo principal en un *checkpoint*. Tres consecuencias medidas en una base
de prueba con el `better-sqlite3` del repo:

1. **El cierre ordenado los limpia.** Al cerrarse la última conexión
   (`store.close()` en el `SIGINT`/`SIGTERM` de `index.ts`), SQLite hace el
   checkpoint y borra `-wal` y `-shm`.
2. **Copiar sólo el `.db` con el servidor andando da una base vieja.** Con la
   conexión abierta, después de borrar 20 000 filas y dejar 56, un `cp` del
   `.db` todavía tenía **20 000**; un `.backup` tenía las 56 correctas.
3. **Un `VACUUM` no achica el archivo en el acto.** El tamaño lógico pasó de
   ~10 MB a 8 KB, pero `orquestador.db` y su `-wal` siguieron en ~10 MB hasta el
   checkpoint. Un `PRAGMA wal_checkpoint(TRUNCATE)` desde otro proceso lo achicó
   al momento, con el servidor abierto.

> [!danger] Nunca borres el `-wal` a mano con el servidor andando
> Puede tener transacciones confirmadas que todavía no están en el `.db`: borrarlo
> las pierde. Y al revés: si **restaurás** un `.db`, borrá antes el `-wal` y el
> `-shm` viejos (con el servidor apagado), o SQLite aplica ese diario ajeno
> encima de la base restaurada.

## Respaldar y restaurar

Con el servidor andando, usá la API de respaldo de SQLite, que sí ve el WAL:

```bash
sqlite3 data/orquestador.db ".backup 'data/backups/orquestador-$(date +%F).db'"
# o, compactado de paso:
sqlite3 data/orquestador.db "VACUUM INTO 'data/backups/orquestador-$(date +%F).db'"
```

Con el servidor apagado (cierre ordenado), un `cp` del `.db` alcanza.

La base **no es todo**. Un respaldo completo de una instalación incluye:

| Carpeta | Qué tiene |
|---|---|
| `data/orquestador.db` | configuración, corridas, trazas, entregables (su texto), memoria |
| `data/proyectos/` | salida (Word, PDF, videos, `publicado/`, `marca/logo.png`), clones y worktrees |
| `data/contexto/` | el vault de cada empresa |
| `data/mcp-oauth/` | tokens OAuth: **secretos**, preservá los permisos y no los subas a ningún lado |
| `data/musica/` | las pistas que pusiste vos |

Para restaurar: apagá el servidor, borrá `orquestador.db-wal` y `-shm`, copiá el
respaldo en `orquestador.db` y arrancá. `data/backups/` es sólo una convención;
nada del código lo lee.

## Compactar

SQLite no le devuelve al sistema el espacio de lo que borrás: lo marca libre y
lo reusa. Después de limpiar corridas con miles de eventos el archivo pesa lo
mismo. `PRAGMA freelist_count` dice cuánto hay para recuperar.

| Cómo | Cuándo |
|---|---|
| `POST /api/mantenimiento/purgar` con `compactar: true` (o el botón de Empresa → Mantenimiento) | con el servidor andando: corre en su propia conexión |
| `sqlite3 data/orquestador.db "VACUUM;"` | con el servidor apagado |

`VACUUM` **nunca va dentro de una transacción**: SQLite lo rechaza ("cannot
VACUUM from within a transaction"). La respuesta de la purga informa
`base.antes/despues` en tamaño **lógico** (`page_count × page_size`), que baja en
el acto; el archivo en disco se ajusta en el checkpoint (al apagar el servidor,
o con `PRAGMA wal_checkpoint(TRUNCATE)`).

## Limpiar

| Qué | Cómo | Se lleva |
|---|---|---|
| Una corrida | `DELETE /api/runs/:id` | eventos, mensajes, tareas, aprobaciones, ledger. **Nunca entregables**. 409 si está `running` o todavía se puede continuar |
| Las terminadas de una empresa | `DELETE /api/companies/:companyId/runs/terminadas` | ídem |
| Las terminadas de todas | `DELETE /api/runs/terminadas` | ídem |
| Una empresa | `DELETE /api/companies/:id` | todas sus filas (entregables incluidos), sus conexiones MCP y la carpeta del proyecto. No el vault ni los tokens OAuth. 409 con corrida viva |
| Lo que generó una empresa | `POST /api/companies/:id/exports-vaciar` | los archivos generados; conserva lo que trajo una persona |
| Residuos de borrados viejos | `POST /api/mantenimiento/purgar` | filas sin padre y carpetas sin empresa |
| Todo | apagar, borrar `orquestador.db` con su `-wal` y `-shm`, `db:migrate`, `db:seed` | todo lo de la base |

Desde la UI está todo junto al pie de **Empresa**, con el diagnóstico antes de
cada botón. Ver [[Limpieza y mantenimiento]].

> [!note] Limpiar corridas no cuesta entregables
> `artifacts.company_id` existe para eso: los entregables son de la empresa, no
> de la corrida.

## Portar una empresa a otra instalación

No hace falta copiar la base:

```bash
curl -s localhost:3001/api/companies/<id>/blueprint > empresa.json
# en la otra instalación:
curl -s -X POST localhost:3001/api/companies/import \
  -H 'content-type: application/json' -d @empresa.json
```

| Viaja | No viaja |
|---|---|
| empresa, departamentos, roles, políticas, servidores MCP (sin credenciales), herramientas built-in y compuestas, repos con origen `git` | corridas, entregables, memoria, solicitudes, **misiones**, sesiones de código, herramientas MCP (se redescubren), repos locales, rutas de `.env` |

El import reasigna todos los ids, clona los repos en segundo plano y deja sus
comandos **pendientes de confirmar**. Es un JSON: versionalo en git.

## Problemas frecuentes

| Síntoma | Causa y salida |
|---|---|
| `SQLITE_BUSY` / "database is locked" | Otro proceso tuvo la escritura más de 5 s (un seed grande, un `VACUUM` a mano). Esperá o apagá uno |
| Una corrida figura "en curso" después de una caída | Se arregla sola al arrancar: `sanearCorridasHuerfanas` la pasa a `stopped` y lo anuncia en el log |
| Aparecen dos empresas iguales | Se sembró dos veces (o `scripts/start.sh`) |
| El archivo no se achica después de purgar | Faltó `compactar`, o falta el checkpoint del WAL |
| El servidor usa otra base que la que mirás | `DATABASE_URL` relativa se resuelve contra la raíz del repo; `db:migrate` imprime la ruta real |

## Qué fijan los tests

Los tests nunca tocan `data/`: `db.test.ts` y `armarEntorno`
(`apps/server/src/testing/entorno.ts`) abren una base nueva en un temporal y la
borran al terminar. Qué comportamiento fija cada uno está en
[[Persistencia y esquema SQL]]; los que importan para operar: `VACUUM` no rompe
la base, la purga anuncia exactamente lo que borra y el saneo de corridas
huérfanas es idempotente.

## Fuentes

- `apps/server/src/db.ts` → `Store` (constructor, `tableCounts`, `vacuum`, `pesoEnDisco`, `sanearCorridasHuerfanas`)
- `apps/server/src/migrate.ts`, `apps/server/src/seed.ts`, `apps/server/src/env.ts` → `loadEnv`, `fromRoot`
- `apps/server/src/index.ts` → saneo al arrancar, cierre ordenado
- `apps/server/src/runtime.ts` → `dirOAuth`, `sembrarHerramientas`
- `scripts/start.sh`, `scripts/seed-*.ts`, `scripts/auditar-corrida.ts`, `scripts/vault-contexto.ts`
- `package.json` → scripts `db:*`, `auditar`

## Ver también

- [[Persistencia y esquema SQL]] · [[Directorios en disco]]
- [[Comandos]] · [[Variables de entorno]] · [[Empresas de ejemplo]]
- [[Limpieza y mantenimiento]] · [[Diagnóstico de problemas]]
