---
tags: [operación]
aliases: [Troubleshooting, Diagnóstico, Problemas, Fallas conocidas]
---

# Diagnóstico de problemas

Fallas conocidas ordenadas por dónde se ve el síntoma. Cada una con **síntoma →
causa → cómo confirmarlo → salida**. El porqué de las reglas que las evitan está
en [[Trampas conocidas]] y en la nota de cada capacidad.

## Arranque y servidor

| Síntoma | Causa | Cómo confirmarlo | Salida |
|---|---|---|---|
| el servidor sirve código viejo, un cambio "no se aplica" | un proceso anterior sigue escuchando en el 3001 | `lsof -i:3001` muestra un pid que no es el de tu terminal | `lsof -ti:3001 \| xargs kill -9` (`pkill -f` no siempre alcanza) |
| no arranca: `X="…" no es un número positivo válido` | `loadEnv` valida al arrancar | el mensaje nombra la variable | corregir `.env` (cero o negativo tampoco vale) |
| no arranca: `TypeError: Invalid URL` | `APP_URL` mal formado: `index.ts` hace `new URL(env.appUrl)` para los orígenes de CORS | revisar `APP_URL` | una URL completa, `http://localhost:5173` |
| Vite: `Port 5173 is already in use` | otra UI abierta; `strictPort` no deja correrse | `lsof -i:5173` | cerrarla |
| una corrida se cortó con "Servidor detenido." mientras editabas el repo | `tsx watch` reinició el servidor | la hora del corte coincide con un guardado | correr el servidor con `npm run start -w @orq/server`; el trabajo abierto lo hereda la próxima corrida |
| al arrancar: "N corrida(s) habían quedado marcadas como vivas… se cerraron" | una caída dura dejó filas `running`/`paused`/`awaiting_approval` | `Store.sanearCorridasHuerfanas` | nada: quedan `stopped` con el motivo |
| "Retomar" contesta 400 "no está activa en memoria" | la corrida no sobrevivió a un reinicio (el estado vivo es de memoria) | `Runtime.estaEnMemoria` | arrancar una corrida nueva: hereda tareas y solicitudes pendientes |
| la UI muestra una corrida "en curso" que ya terminó | se leyó `active.run` y no `orchestrator.snapshot` | bug de lectura | usar el snapshot (ver [[Trampas conocidas]]) |
| todos los `DELETE` de la UI contestan 400 | `content-type: application/json` con cuerpo vacío | la request lleva el header sin body | `apps/web/src/api.ts` sólo lo pone si hay cuerpo: no cambiarlo |

## Proveedor LLM

| Síntoma | Causa | Cómo confirmarlo | Salida |
|---|---|---|---|
| la corrida muere en el **tercer ciclo** sin producir nada, `failed` con "3 ciclos seguidos sin un solo turno completado" | **402**: cuenta sin crédito. 402 no es reintentable y `TICKS_FALLIDOS_TOLERADOS = 3` corta | `npm run check:llm` (la llamada real devuelve el 402; `check:models` pasa igual porque sólo lista modelos) | recargar saldo o pasar la empresa a tier `free` / a una suscripción |
| turnos lentos, `log` "Reintentando…", después sigue | 429 o 5xx: `withRetry` hace 4 intentos con esperas de 2, 4 y 8 s | eventos `log` de nivel `warn` en la traza | nada; si es sistemático, tier `standard` o fijar el upstream en OpenRouter |
| "Ningún turno del ciclo terminó… Se reintenta en 30 s" | un ciclo entero falló: se espera 30 s, 60 s, 120 s antes del siguiente | log `warn` sin `roleId` | esperar; `ORQ_ESPERA_PROVEEDOR_MS` ajusta la base |
| "El proveedor \"x\" no está configurado. Configurados: …" | el rol pide un proveedor sin credencial | `/proveedores` o el log de arranque | agregar la credencial y reiniciar, o cambiar el proveedor del rol |
| "Ningún modelo de X califica para el tier …" | las bandas de precio no encuentran candidato (típico con proveedores sin precios) | `npm run check:models` muestra "sin candidatos" | fijar `modelSlug` del rol desde la UI |
| `claude-sesion` contesta 401 | una `ANTHROPIC_API_KEY` definida gana sobre el token, o el token venció | el `healthCheck` lo explica en `/proveedores` | `export ANTHROPIC_AUTH_TOKEN=$(ant auth print-credentials --access-token)` y reiniciar; no dejar la API key vacía fuera del arranque |
| `claude-code` falla en todos los turnos | `claude` no instalado, no logueado, o fuera del PATH del servidor | `claude --version` en la misma terminal; `check:models` corre un turno real | instalar y `claude auth login` |
| `opencode` 401 en el primer ciclo | la credencial de `opencode auth login` no tiene saldo | `opencode auth list` | otra credencial o un modelo `-free` |
| Ollama aparece configurado y falla | `.env.example` trae `OLLAMA_BASE_URL` con valor | `check:models`: "Ollama no responde en …" | vaciar la variable |
| la pantalla Proveedores tarda | `/api/providers` corre `healthCheck` de todos: en `claude-code` y `opencode` es un turno real | tiempos del endpoint | es esperado |
| el CEO se pone a hacer trabajo operativo | rol que coordina en tier `cheap` | tier del rol | `cheap` sólo para ejecutores ([[Capa LLM y tiers]]) |

## Turnos delegados (`claude-code`, `opencode`)

| Síntoma | Causa | Cómo confirmarlo | Salida |
|---|---|---|---|
| huecos de **15 minutos** sin ninguna llamada en un turno | la API no contesta (Opus saturado); el CLI esperaba callado | transcripción en `CLAUDE_CODE_WORKDIR/transcripciones/` (últimas 300) | ya mitigado: vigilante de silencio de 180 s (`CLAUDE_CODE_SILENCIO_MS`), `--fallback-model` y `CLAUDE_CODE_MAX_RETRIES=4`. El aviso "respondió otro modelo" queda en la traza |
| un turno termina con `AVISO_DE_CORTE` pegado al resumen | corte por tiempo: 10 min (código 25) en Claude Code, 20 min (código 30) en opencode | el aviso en el texto | subir `CLAUDE_CODE_CODIGO_TIMEOUT_MS` / `OPENCODE_TIMEOUT_MS`, o partir el trabajo |
| turno registrado como fallido "sin resumen" aunque el trabajo está hecho | el CLI cerró con `is_error` | la traza muestra herramientas exitosas | el adaptador rescata el último texto del agente (`ultimoTextoDeAsistente`); si no hubo texto, no hay qué rescatar |
| aviso "la suscripción va por el 80 % de su ventana" | `rate_limit_event` del CLI | el aviso en la traza | bajar tier o esperar la ventana |
| el agente deja de poder leer a mitad de turno | freno por largo de delegación: aviso a las 50 llamadas, lecturas negadas a las 80 | resultados de lectura rechazados | es a propósito: entregar lo averiguado. Ver [[Turnos delegados a un CLI]] |
| decenas de `ToolSearch` en un turno | carga diferida de herramientas en el CLI | transcripción | `ENABLE_TOOL_SEARCH=false` ya se inyecta; revisar que nadie lo haya pisado |
| el CLI no ve un servidor MCP que tenés en tu Claude Code | `--strict-mcp-config`: sólo entra el puente del org | argumentos del CLI | darlo de alta en la empresa ([[Integración MCP]]) |

## La corrida

| Síntoma | Causa | Cómo confirmarlo | Salida |
|---|---|---|---|
| queda en `awaiting_approval` y retomar no hace nada | se resolvió todo por la API pero la corrida tenía su copia de la solicitud | la bandeja de Solicitudes está vacía | `runContinuous` se destraba solo si no queda nada pendiente; contestar desde la UI llama `reanudarSiEsperaba` |
| pausar parece no frenar | la pausa se hace efectiva **al cerrar el ciclo**: el turno en vuelo no se aborta | el estado pasa a `paused` después del ciclo | esperar al cierre; detener sí corta |
| "completed" en pocos ciclos sin entregable | pedido perdido: nadie produjo nada | el scheduler la marca `failed` ("no informa éxito cuando nadie produjo nada") | revisar el encargo y los reencolados |
| un rol toma turno ciclo tras ciclo sin ejecutar nada | livelock por tarea abierta | turnos sin herramientas en la traza | el scheduler deja de convocarlo tras 2 turnos vacíos; un mensaje nuevo lo reactiva |
| la corrida se corta por presupuesto | `budgetUsd` alcanzado (se evalúa antes de cada turno) | razón de fin | ver [[Costos y presupuesto]] |
| la misión no disparó | la empresa ya tenía una corrida viva (`tieneCorridaViva`) | log de misiones | se reprograma sola; ver [[Misiones programadas]] |
| se contestó una solicitud y ningún agente la vio | la corrida que la pidió ya había cerrado | la respuesta aparece como lección en Memoria | es el comportamiento esperado |
| un nodo queda "pensando…" | falta `agent.turn_end` | traza | se emite en `finally`; si aparece, es un bug nuevo |

## Agentes y herramientas

| Síntoma | Causa | Cómo confirmarlo | Salida |
|---|---|---|---|
| "no encuentro `export_video`" | la habilidad no está en la tabla `tools` o en `role.toolIds` | pestaña Empresa del rol | asignarla; en un seed, registrar también las habilidades |
| a un rol del estudio le falta `export_video_estudio` o `grabar_clip` | el seed se corrió en una máquina sin Chrome: el catálogo se arma con lo que hay y los ids que no existen se descartan en silencio | log del seed ("sólo coordinación") | instalar Chrome, reiniciar y asignar desde Empresa |
| `generar_imagen` no aparece | ni `GOOGLE_API_KEY`/`GEMINI_API_KEY`, ni `OPENAI_API_KEY`, ni `NVIDIA_API_KEY` | `.env` | agregar una y reiniciar |
| el agente informa que algo falló pero lo hizo (o al revés) | lo que cuenta un agente no es evidencia | `check_activity`, `estado_del_proceso`, `npm run auditar` | ver [[Supervisión y continuidad]] y [[Auditoría de corridas]] |
| una lección dice que una herramienta "está rota" | casi siempre lo que la herramienta mostró engañó al agente | reproducir la llamada | refutar la lección desde Memoria ([[CU-12 Refutar una lección falsa]]) |
| el auditor "encuentra" errores que no existen | le falta la fecha o la fuente para verificar | su evidencia | ver [[CU-04 Control de calidad entre agentes]] |
| entregables fragmentados (`-v2`, `-final`) | modelo barato versionando mal | la guardia de claves-variante los rechaza | revisar tier |
| un agente insiste con la misma llamada fallida | error que no puede resolver | a la 3ª idéntica se le pide cambiar de enfoque; si insiste, se corta el turno | corregir lo que falla (permiso, ruta, credencial) |

## MCP

| Síntoma | Causa | Cómo confirmarlo | Salida |
|---|---|---|---|
| semáforo en `error` | comando mal, ruta inexistente, o una referencia de `envRefs`/`headerRefs` sin valor | la salud lista `envFaltantes` | poner la variable en `.env` y reiniciar |
| un servidor borrado sigue en el Hub en `ready` | servidor fantasma: el mapa de salud conservaba la entrada | ya no se muestra (`Runtime.mcpHealth` filtra por lo configurado) | si aparece, recargar la UI |
| búsquedas de Brave: la segunda del mismo segundo falla con 429 | plan Free: 1 consulta por segundo | texto "429"/"rate limit" en el resultado | la fila del servidor reintenta 2 veces esperando ≥1,1 s o lo que diga `retry-after` (tope 15 s); si es cuota diaria, no se arregla insistiendo |
| servidor HTTP con "Autorizar" que no conecta | OAuth pendiente: el puente **no reintenta** hasta que alguien inicie sesión | `health.autorizacion` | apretar Autorizar; ver [[OAuth para servidores MCP]] |
| certificado rechazado en un MCP interno | CA propia | error TLS | declarar `caPath` (verifica, no saltea) |
| instalaste desde la tienda y nadie usa las herramientas | la tienda instala **sin otorgar** | `toolIds` de los roles | asignarlas en Empresa; llegan también a la corrida viva |
| `npm audit` grita por `@hono/node-server` | llega por el SDK de MCP y no es alcanzable | `package.json` → `auditNotes` | no forzar el override |

## Código

| Síntoma | Causa | Cómo confirmarlo | Salida |
|---|---|---|---|
| "En esta máquina no hay sandbox-exec…" | no es macOS o falta `/usr/bin/sandbox-exec` | `hayAislamiento()` | habilitar `sinAislamiento` en el repo sólo si aceptás correr sin contención |
| "no está entre los comandos permitidos de este repo" | allowlist por token | Repositorio → Comandos | `solicitar_comando` (una vez o siempre) |
| un checkpoint falla con "index.lock: File exists" | dos gits sobre el mismo worktree | — | mitigado: `GIT_OPTIONAL_LOCKS=0` y hasta 8 reintentos; un lock que no se suelta es un git colgado |
| `npm test` de un agente no termina | vitest/jest en watch | — | `CI=1` ya se inyecta; revisar que el script no fuerce watch |
| el backend de un proyecto muere con "require is not defined" | `ts-node-dev` escribe su hook en `TMPDIR` y Node toma el `"type": "module"` del orquestador | existe `data/proyectos/package.json` | `Directorios.prepararRaiz` lo crea al arrancar; si lo borraste, reiniciar |
| la vista previa muestra datos del backend "de verdad" | una URL local de un `.env` no se reescribió | panel del servicio: avisos de URLs | `redirigirUrlsLocales`; para URLs de la propia app que apuntan afuera, el click `{url:backend}` |
| "No hay puertos libres entre 4300 y 4399" | vistas previas vivas de más | `.servicios-vivos.json` | detener servicios |
| un servicio no arranca: "sin dependencias" | falta `node_modules` en la sesión | panel del servicio | "Preparar" (clona con `cp -c` si el lockfile coincide, si no `npm ci --ignore-scripts`) |
| agregaste una dependencia y el proyecto no la tiene | nada se instala sin aprobación | Solicitudes | aprobar: aprobar instala |

## Celular

| Síntoma | Causa | Cómo confirmarlo | Salida |
|---|---|---|---|
| escaneás el QR y a los 3 min dice "Pasaron tres minutos sin que el teléfono escaneara el código" | el servidor de adb dejó de ver mDNS: `adb mdns services` devuelve vacío aunque el teléfono esté anunciando | `adb mdns services` en una terminal con el QR en pantalla | **`adb kill-server`** (arranca solo en el próximo comando) y volver a vincular |
| "Vinculado, pero el teléfono todavía no anunció la depuración" | el servicio de conexión tarda o no aparece | `adb devices -l` | apagar y prender la depuración inalámbrica |
| la app se queda sin Metro ni API tras bloquear el teléfono | adb reconectó (otro `transport_id`) y los túneles eran de la conexión vieja | — | el vigilante de 10 s los re-tiende solo; si no, "Abrir la app" |
| captura negra / la captura se niega | pantalla apagada (`mWakefulness=Dozing`) o la app no está al frente | `estado_de_la_app` | prender la pantalla y traer la app |
| en Samsung, "user 150" | carpeta segura | — | todo va con `--user current` |
| el espejo no arranca con scrcpy | versión del protocolo | `scrcpy --version` | la versión se lee del instalado; queda el respaldo `screenrecord` |
| "No hay un JDK 17" | falta JDK | `/usr/libexec/java_home -v 17` | Android Studio o `brew install openjdk@17` |
| "No se encontró el SDK de Android" o faltan build-tools | adb viene de fuera del SDK (el SDK se deduce subiendo dos carpetas desde adb) | `which adb` | usar el SDK de Android Studio o definir `ANDROID_HOME` |
| un módulo nativo nuevo no llega a la build | — | — | reinstalar: siempre pasa por `expo prebuild` |
| el AAB sale en rojo | clave de depuración, `versionCode` no mayor, certificado distinto al anterior, permiso bloqueado o bundle apuntando a desarrollo | el `.json` junto al AAB | no subirlo; ver [[Build de producción Android]] |
| `consultar_base_de_la_app` falla con opciones desconocidas | un `sqlite3` viejo primero en el PATH (platform-tools trae el suyo) | `which -a sqlite3; sqlite3 --version` | uno ≥ 3.37 (`-safe`) primero en el PATH |
| `manejar_app` se niega | el entorno de la app apunta a producción | el motivo nombra las variables | pasar la app a staging; explorar sí se permite |

## Video y audio

| Síntoma | Causa | Cómo confirmarlo | Salida |
|---|---|---|---|
| cualquier export de video falla y `ffmpeg -version` tira `dyld: Library not loaded … lib*.dylib` | Homebrew actualizó una dependencia (p. ej. x265) y el ffmpeg instalado quedó roto | `ffmpeg -version` | `brew reinstall` de la fórmula de ffmpeg que uses |
| `No such filter: 'ass'` / los rótulos de clips no salen | ffmpeg sin libass o sin freetype (`drawtext`) | `ffmpeg -hide_banner -filters \| grep -wE "ass\|drawtext"` | un build con libass; ver [[Dependencias del sistema]] |
| el video sale **mudo** | falló la voz o la mezcla | `inspeccionar_medio` dice "SIN PISTA DE AUDIO" | revisar Kokoro/`say` y los avisos del export |
| la cama no se escucha, o tapa la voz | nivel de la cama | renderizar con y sin música y restar, en los huecos entre frases | la cama va a −26 LUFS con ducking `ratio=4`, `attack=5`, `release=300` (`sonido.ts`); no subirla a ojo |
| la cama suena acelerada | `aresample` antes de `loudnorm` (devuelve 192 kHz) | cadena de filtros | va después |
| video en silencio con pistas en la carpeta | `MUSICA_DIR` apunta a otro lado o el nombre no coincide con lo pedido | ruta y nombres | la biblioteca se recorre en profundidad; `musica: "ninguna"` apaga a propósito |
| la voz es la de macOS | Kokoro no está donde se lo busca | `ls ~/.cache/orq-kokoro` o `ORQ_KOKORO_HOME` | ver [[Dependencias del sistema]] |
| el video dice ":objetivo:" o lee nombres de personajes | trampas del guion (marca sola en su renglón, diálogo con renglones en blanco) | el guion | ver [[Guion como línea de tiempo]] |
| la portada lee "Personajes:", "Tono:" | texto suelto entre el `#` y la primera `##` es narración de portada | aviso del motor de clips | sacarlo del guion |
| el video dura distinto a lo que "informó" el agente | se repitió lo que dijo la exportación | `inspeccionar_medio` | medir siempre el archivo |

## Documentos y UI

| Síntoma | Causa | Salida |
|---|---|---|
| el PDF tiene el doble de páginas | se escribió debajo del margen inferior | ya resuelto en `render.ts`; ver [[Documentos Word y PDF]] |
| "✅ Sí" salió como "' Sí" | emoji con fuente WinAnsi | `sinEmoji` |
| media tabla maquetada y el resto con pipes | línea en blanco entre grupos de filas | ya se tolera |
| el PDF se descarga en vez de verse | falta `?inline` | la UI lo agrega |
| el organigrama está vacío con los nodos en el DOM | React Flow perdía la medición | `OrgGraph` reusa nodos con `useNodesState` |
| la página desborda a lo ancho | falta `min-w-0` en una columna de grilla | agregarlo |

## Fuentes

- `apps/server/src/index.ts`, `env.ts`, `db.ts` → `sanearCorridasHuerfanas`, `routes.ts` (resume, `/api/providers`)
- `packages/engine/src/scheduler.ts` → `TICKS_FALLIDOS_TOLERADOS`, `ESPERA_BASE_MS`, `TURNOS_VACIOS_TOLERADOS`
- `packages/engine/src/loop.ts` → `withRetry`; `packages/engine/src/claude-mcp.ts` → `TOLERANCIA_IDENTICA`
- `packages/llm/src/adapters/claude-code.ts`, `opencode.ts`, `openrouter.ts`, `anthropic.ts`
- `packages/tools/src/mcp/bridge.ts` → `esLimiteDeTasa`, `REINTENTOS_POR_LIMITE`
- `apps/server/src/dispositivos.ts` → `esperarTelefono`, `TIEMPO_VINCULO_MS`, `detectarJava`
- `apps/server/src/git.ts`, `servicios.ts`, `aab.ts`, `depuracion-movil.ts`
- `packages/tools/src/skills/sonido.ts` → `MUSICA`, `DUCKING`; `skills/medios.ts` → `describirFicha`

## Ver también

- [[Trampas conocidas]] · [[Comandos]] · [[Dependencias del sistema]]
- [[Variables de entorno]] · [[Instalación y arranque]] · [[Estado del producto]]
