---
tags: [referencia, código]
aliases: [argvSchema, repositorioSchema, origenRepositorioSchema, comandosRepositorioSchema, servicioSchema, tipoServicioSchema, sesionCodigoSchema, tokenizar, decidirComando, validarPrefijoPermitido, validarPaquete, argvDeInstalacion, clasificarServicio, redirigirUrlsLocales, parsearDotenv, Repositorio, Servicio, SesionCodigo]
---

# Esquemas de código y servicios

El código que una persona carga en un proyecto, las sesiones donde trabajan los
agentes, las partes de un monorepo que se levantan, y las reglas puras de
comandos y paquetes. Esquemas en `packages/shared/src/schema.ts`; reglas en
`argv.ts`, `dependencias.ts` y `servicios.ts` del mismo paquete. Convenciones:
[[Referencia de esquemas]]. El comportamiento: [[Trabajo con código]].

## `argvSchema`

`string[]`, cada token 1–400, entre 1 y 40 tokens. Un comando es **siempre
argv, nunca texto de shell**: guardada como string, la allowlist habilitaba
`npm testx` y `npm test; rm -rf ~` por prefijo.

## `origenRepositorioSchema`

Unión discriminada por `tipo`:

| `tipo` | Campo | Para qué |
|---|---|---|
| `local` | `ruta` (1–1.000) | carpeta de esta máquina: se **clona** (o se copia si no tiene git); nunca se toca |
| `git` | `url` (1–1.000) | sin credenciales: las pone el ayudante de git de la máquina (`validarUrlGit` rechaza `user:token@`, `ext::`, `file://`, `-…`) |
| `creado` | `descripcion` (≤ 500, `""`) | programa nuevo de la empresa (`crear_repositorio`); integrar es avanzar su `main` |

## `comandosRepositorioSchema`

| Campo | Tipo | Default | Para qué |
|---|---|---|---|
| `permitidos` | argv[] | `[]` | prefijos que un agente corre sin preguntar |
| `preparar` | argv, nullable | `null` | lo que deja un worktree listo (`npm ci`); lo aprueba una persona |
| `test` | argv, nullable | `null` | cómo se corren los tests |
| `verificar` | argv, nullable | `null` | typecheck, lint, build |
| `sinAislamiento` | boolean | `false` | correr sin `sandbox-exec`: opt-in explícito de una persona |
| `unaVez` | argv[] | `[]` | permisos de un solo uso, por argv exacto; se consumen |

## `tipoServicioSchema` y `servicioSchema`

Tipos: `web` · `api` · `movil` · `docs` · `otro`.

| Campo | Tipo | Default | Para qué |
|---|---|---|---|
| `id` | string 1–60 | — | slug estable dentro del repo (`backend`): lo nombran los agentes |
| `nombre` | string 1–80 | — | |
| `carpeta` | string ≤ 300 | `""` | relativa a la raíz; `""` es la raíz |
| `tipo` | `TipoServicio` | — | |
| `arrancar` | argv, nullable | `null` | cómo se levanta; `{puerto}` se reemplaza (`argvDeArranque`). `null` = no se levanta (docs) |
| `variablePuerto` | string ≤ 60, nullable | `null` | `PORT`, si el programa lo lee |
| `puertoOriginal` | entero 1–65.535, nullable | `null` | el que usa en la máquina de la persona: sirve para redirigir URLs |
| `salud` | string ≤ 200, nullable | `null` | ruta de salud (`/health`); sin esto, `/` |
| `inicio` | string ≤ 300 | `"/"` | dónde abre la vista previa |
| `archivosEntorno` | string[] (≤ 8, rutas absolutas) | `[]` | `.env*` de la persona: se leen al arrancar, no se copian ni se exportan |
| `entorno` | `Record<string,string ≤ 2.000>` | `{}` | variables sin secretos que pisan a las de los archivos; `{url:backend}` es la URL de otro servicio (`expandirUrls`) |
| `marcadoresProduccion` | string[] (5–200 c/u, ≤ 20) | `[]` | textos que delatan producción en el entorno: con uno presente, un agente no maneja la app |

## `repositorioSchema`

| Campo | Tipo | Default | Para qué |
|---|---|---|---|
| `id`, `companyId` | `idSchema` | — | `rep_…` |
| `nombre` | string 1–120 | — | único por proyecto: es el argumento `repo=` de las herramientas |
| `slug` | string 1–60 | — | carpeta del clon: `repos/<slug>`; no cambia al renombrar |
| `origen` | `OrigenRepositorio` | — | |
| `ramaBase` | string 1–200 | `"main"` | rama sobre la que se abren sesiones e integra |
| `baseSha` | string, nullable | `null` | commit del clon del que parten las sesiones |
| `origenSinGit` | boolean | `false` | el origen local no tenía git: se integra copiando archivos |
| `comandos` | `ComandosRepositorio` | `{}` (→ defaults internos) | |
| `servicios` | `Servicio[]`, ≤ 20 | `[]` | se detectan al cargar y se editan en la UI |
| `commitsAutomaticos` | boolean | `false` | por default los turnos no commitean: toman instantáneas y la persona commitea |
| `pendienteDeConfirmar` | boolean | `false` | llegó de un blueprint: hasta confirmar la allowlist no se ejecuta nada |
| `createdAt` · `updatedAt` | timestamp | — | |

Se parsea **al leer** (`Store.listRepositorios`, `getRepositorio`), así que los
defaults nuevos sí llegan a las filas viejas.

## `sesionCodigoSchema`

Estados (`estadoSesionCodigoSchema`): `abierta` · `integrada` · `descartada`.

| Campo | Tipo | Default | Para qué |
|---|---|---|---|
| `id`, `companyId`, `repoId` | `idSchema` | — | `ses_…`; una abierta por repo |
| `rama` | string 1–200 | — | la **rama del proyecto** (`dev`) si el repo vino de afuera con git; `orq/<fecha>-<sufijo>` si es creado o copia sin git (`RepoStore.usaRamaDelProyecto`) |
| `carpeta` | string 1–500 | — | relativa a la carpeta del proyecto: `worktrees/<repo>/<rama>` |
| `baseSha` | string | — | base de la sesión |
| `estado` | `EstadoSesionCodigo` | `"abierta"` | |
| `creadaEnRunId` | id, nullable | `null` | sobrevive a la corrida que la abrió |
| `integracion` | `{modo: fast-forward/rama/copia, detalle ≤ 4.000, at}`, nullable | `null` | cómo terminó integrada |
| `createdAt` · `updatedAt` | timestamp | — | |

El comentario del esquema todavía habla de "su rama `orq/…`"; el código ya usa la
rama del proyecto. Ver [[Repositorios y sesiones]].

## Reglas puras de comandos — `argv.ts`

Código puro compartido por el servidor (cuando una persona edita la allowlist) y
`ejecutar_comando`: con dos copias, lo que una aceptaba la otra rechazaba.

| Símbolo | Qué hace |
|---|---|
| `tokenizar(comando)` → `Tokenizado` (`{ok, argv}` o `{ok: false, motivo}`) | parte respetando comillas; no expande nada; rechaza `; & \| < > $ \` * ?` y saltos de línea explicando que no hay shell |
| `argvATexto(argv)` | argv legible, citando lo que haga falta |
| `validarPrefijoPermitido(argv)` → `Validacion` | ¿sirve como entrada de la allowlist? rechaza rutas, shells y comandos de red o borrado; `node`/`npx`/`python`… sólo con lo que corren; `npm`/`pnpm`/`yarn`/`bun` sin subcomando o con `run` sin script; `publish`, `login`, `config`…; `git` sin subcomando o con `push`/`remote`/`config`/`credential`/`submodule`/`filter-branch`/`gc`/`worktree` |
| `empiezaCon(argv, prefijo)` | comparación **token por token**: `npm test` no habilita `npm testx` |
| `decidirComando(argv, {permitidos, unaVez})` → `Decision` | orden: git prohibido → lectura de git (`status`, `diff`, `log`, `show`, `blame`, `ls-files`, `grep`, `rev-parse`, `shortlog`, `describe`, sin `--output`/`--ext-diff`/`--textconv`/`--exec`/…) → allowlist → una vez (argv exacto) → negado con instrucción de pedirlo por `solicitar_comando` |

La allowlist **no es la frontera de seguridad**: permitir `npm test` es permitir
los tests que escribió el agente. La contención es el sandbox. Ver
[[Comandos y sandbox]].

## Reglas de paquetes — `dependencias.ts`

| Símbolo | Qué hace |
|---|---|
| `GestorDePaquetes` | `"npm"`/`"pnpm"`/`"yarn"` |
| `MAX_PAQUETES_POR_PEDIDO` | `10` |
| `validarPaquete(spec)` | sólo nombres del registro (con scope y versión opcionales, sin mayúsculas, ≤ 214); rechaza URLs, `git:`, `file:`, rutas |
| `argvDeInstalacion(gestor, paquetes, {dev})` | siempre con `--ignore-scripts` (npm además `--no-audit --no-fund` y `--save`/`--save-dev`) |
| `gestorPorArchivos(archivos)` | por lockfile: `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, si no npm |

Ver [[Instalación de dependencias]].

## Reglas de servicios — `servicios.ts`

| Símbolo | Qué hace |
|---|---|
| `PaqueteNode`, `CarpetaCandidata` | lo leído del disco de una carpeta: `package.json`, cantidad de `.md`, si tiene `.obsidian`, puertos encontrados (Vite, `.env`, código), ruta de salud, `.env` existentes |
| `clasificarServicio(candidata)` | en este orden: Expo → `movil` (puerto 8081, `--web`); Next → `web` (3000); Vite con `dev` → `web` (puerto de la config o 5173, `--strictPort --host 127.0.0.1`); servidor HTTP conocido (express, fastify, koa, nest, hono…) → `api` con `PORT`; otro script en subcarpeta → `otro`; carpeta de notas → `docs`; si no, `null` |
| `conIdsUnicos(servicios)` | desambigua ids repetidos con `-2`, `-3`… |
| `argvDeArranque(servicio, puerto)` | reemplaza `{puerto}` |
| `parsearDotenv(texto)` | lo que entiende `dotenv`: comentarios, `export`, comillas, `\n` en dobles |
| `redirigirUrlsLocales(variables, destinos)` → `{variables, redirecciones: Redireccion[], externas}` | reescribe `localhost:<puerto original>` a la URL del servicio levantado (elemento por elemento en listas con comas) y avisa de las URLs **de la propia app** que apuntan afuera |
| `expandirUrls(valor, urls)` | `{url:backend}` → URL del servicio; lo desconocido queda a la vista |
| `esClaveSecreta(clave)` | `KEY`, `TOKEN`, `SECRET`, `PASSWORD`, `CREDENTIAL`, `DSN`, `PRIVATE`, `AUTH`, `COOKIE`, `SESSION` → no se muestra el valor |

Expo va primero porque trae `react-dom` y a veces Vite: clasificado como web se
levanta con el comando equivocado. Ver [[Servicios del monorepo]].

## Qué fijan los tests

- `packages/shared/src/argv.test.ts` — comillas sin expansión, rechazo de
  sintaxis de shell, comparación por token, prefijos que lo permiten todo,
  lectura de git siempre y escritura nunca.
- `packages/shared/src/dependencias.test.ts` — sólo paquetes del registro;
  siempre sin scripts; gestor por lockfile.
- `packages/shared/src/servicios.test.ts` — Express con su puerto y salud, Vite
  sólo en localhost, Expo móvil aunque traiga `react-dom`, notas de Obsidian como
  docs, redirección frontend → backend de la vista previa, avisos sólo de URLs de
  la app, `.env` con comentarios y comillas.

## Fuentes

- `packages/shared/src/schema.ts` — `argvSchema`, `origenRepositorioSchema`, `comandosRepositorioSchema`, `tipoServicioSchema`, `servicioSchema`, `repositorioSchema`, `estadoSesionCodigoSchema`, `sesionCodigoSchema`
- `packages/shared/src/argv.ts` — `tokenizar`, `argvATexto`, `validarPrefijoPermitido`, `empiezaCon`, `decidirComando`
- `packages/shared/src/dependencias.ts` — `validarPaquete`, `argvDeInstalacion`, `gestorPorArchivos`
- `packages/shared/src/servicios.ts` — `clasificarServicio`, `redirigirUrlsLocales`, `parsearDotenv`, `expandirUrls`, `esClaveSecreta`
- `apps/server/src/repos.ts` — `RepoStore.usaRamaDelProyecto`
- `apps/server/src/db.ts` — lecturas parseadas de repos y sesiones

## Ver también

- [[Referencia de esquemas]]
- [[Trabajo con código]]
- [[Comandos y sandbox]]
- [[Servicios del monorepo]]
- [[Configuración de repos y servicios]]
