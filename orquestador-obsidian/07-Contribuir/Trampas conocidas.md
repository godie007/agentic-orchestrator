---
tags: [contribuir, referencia]
aliases: [Trampas, Bugs históricos, Gotchas, Lo pagamos]
---

# Trampas conocidas

Cada fila es algo que ya pasó y costó tiempo, tokens o un video mal filmado. Está
acá para que no vuelva a pasar, y porque **el motivo importa más que la regla**.
Formato: **síntoma** (lo que ve una persona) → **causa** → **defensa** (dónde
vive en el código). Las reglas que salieron de acá están en
[[Invariantes de arquitectura]]; para diagnosticar por síntoma, ver
[[Diagnóstico de problemas]].

> [!tip] El corolario que vale para todas
> **Si un agente concluye que una herramienta está rota, sospechá primero de lo
> que la herramienta le mostró.** Y un falso positivo persistido en la memoria es
> peor que el error que lo causó.

## Motor y corridas

| Síntoma | Causa | Defensa |
|---|---|---|
| Mensajes firmados por el rol equivocado; un rol que se escribe a sí mismo | el actor vivía en un campo mutable de `RunState` y los turnos paralelos se lo pisaban entre `await` | `RunState.forActor` con el actor en el closure; test con 4 agentes en `scheduler.test.ts` |
| Una corrida detenida dice "está en curso" | se leía `active.run`, que no se actualiza al pausar o detener | leer `orchestrator.snapshot` (`Runtime.estaViva`, `sePuedeContinuar`) |
| El servidor entero se cae al pedir "continuar" | `POST /runs/:id/resume` hacía `void runtime.resume(id)`; sobre una corrida que no sobrevivió al reinicio el `throw` salía por una promesa sin dueño y **Node se cae**. Lo pagamos dos veces en una tarde | validar antes con `Runtime.estaEnMemoria` y `.catch` en el `void` (`routes.ts`). Todo fire-and-forget del servidor necesita las dos cosas |
| Una corrida vieja no se puede continuar | el estado vivo está en memoria; la traza sí se persiste | es una limitación; las tareas abiertas se heredan en la corrida nueva |
| Una corrida en `running` para siempre y misiones de esa empresa bloqueadas | una caída dura dejaba la fila en `running`; `tieneCorridaViva` la veía viva | `Store.sanearCorridasHuerfanas()` al arrancar (`index.ts`) |
| "Servidor detenido" a mitad de una corrida mientras editás el orquestador | `tsx watch` reinicia con cualquier cambio en lo que el servidor importa, `packages/` incluidos | esperar a que termine o correr sin `watch` |
| Pausar parpadea y la corrida sigue | en modo continuo, entre ciclos el estado ya era `paused` y el bucle arrancaba el siguiente | `pauseRequested`, mirado por `runContinuous` antes de cada ciclo |
| Una corrida esperando una respuesta ofrece "borrar" | cada lado escribía su lista de estados terminales en negativo y `awaiting_approval` caía entre las terminadas | `esCorridaTerminal` en `@orq/shared`; el freno de borrado usa `sePuedeContinuar` |
| "Limpiar terminadas" se lleva las pausadas | el filtro usaba `estaViva` (sólo `running`) | `sePuedeContinuar` (en memoria y no terminal) |
| Aprobar no hace nada visible; hay que apretar "continuar" | resolver la última aprobación deja la corrida en `paused` | `Runtime.reanudarSiEsperaba` también desde `paused` |
| Una corrida con todo resuelto queda en `awaiting_approval` | la corrida tiene su propia copia de las solicitudes; resolver por la API sólo tocaba la base | `RunState.resolverSolicitud`; `runContinuous` se destraba si no queda nada pendiente |
| La respuesta a una solicitud no le llega a nadie | la corrida que la creó murió; otra la heredó pendiente | `notifyRequester` busca la corrida viva que la tenga y reanuda esa; si no hay ninguna, la guarda como `Learning` |
| El nodo del organigrama queda "pensando…" para siempre | un turno falló sin emitir `agent.turn_end` | `agent.turn_end` en el `finally` de `runAgentTurn` |
| Queda un orquestador escribiendo eventos de una corrida borrada | no se la soltaba del runtime | `Runtime.olvidarCorrida` |
| Catorce ciclos seguidos sin producir y la corrida muere por límite | una tarea abierta convocaba al mismo rol aunque sólo hablara | `turnosSinHacerNada` + `TURNOS_VACIOS_TOLERADOS` (2); un mensaje nuevo lo reactiva |
| Un rol con una tarea `blocked` nunca vuelve a trabajar | `rolesWithWork` sólo cuenta `pending` e `in_progress`; `blocked` e `in_review` no convocan | **sigue viva**: alguien tiene que escribirle cuando se destraba |
| "completed" en 3 ciclos por centavos y cero entregables | leer un mensaje lo saca de la bandeja: el pedido desaparecía si el ejecutor se quedaba sin turnos | `reencolarSolicitudesSinResponder` (hasta 2 reenvíos) y el corte de corrida vacía (`failed`) |
| Una corrida cierra con sólo la primera etapa hecha | quien coordinaba recibió el primer entregable y no encadenó | el executive recibe "¿está cumplido el encargo?" antes de cerrar (`cierrePedido`) |
| Un pedido del chat bien resuelto termina "failed — sin producir nada" | el detector contaba entregables y mensajes, no ediciones de código ni consultas | `escribioCodigo` (`HERRAMIENTAS_QUE_ESCRIBEN_CODIGO`, `cli:Edit/Write`) y `respondio` en corridas con `foco` |
| El agente del chat rehace el pedido entero (diez fotos más) | un aviso de sistema llegado con el turno en vuelo lo volvía a convocar | una corrida con `foco` ya respondida y sin pendientes termina ahí |
| Un ciclo que tarda once minutos | una llamada de 649 s; el ciclo espera al más lento | corte por tiempo (`llmTimeoutMs`, 120 s por defecto) con reintento |
| La corrida quema los 50 ciclos en un minuto | el proveedor rechaza todo (402, caído) | 3 ciclos sin un turno bueno → `failed`, con espera creciente entre ciclos |
| Seis turnos delegados fallan juntos | `AGENT_CONCURRENCY` se usaba como piso | es un techo (`runTurns`) |
| Un error irresoluble come las `maxTurns` | el modelo repite la misma llamada fallida | 3 idénticas o 5 por el mismo motivo cortan el turno (loop y puente delegado) |

## Costo y contexto

| Síntoma | Causa | Defensa |
|---|---|---|
| 534k tokens de entrada para 2k de salida (259:1) | `read_artifact` con `start=4000` inventado: se ignora y devuelve todo; la huella del memo incluía el argumento y cada llamada parecía nueva | huella sólo con claves declaradas (`huellaDeLectura`) y puntero en la relectura |
| Se lee la versión vieja después de editar | el memo del puente delegado no se vaciaba nunca | `invalidarMemo` compartido con el loop |
| 21,1M tokens de entrada para 132k de salida en seis agentes | turnos delegados de 145, 112 y 108 llamadas contra una mediana de 21: costo cuadrático | freno por largo (aviso 50, tope 80) en `claude-mcp.ts` |
| 132 lecturas en 298 llamadas; el mismo informe leído 90 veces | `read_artifact` devolvía un índice y el agente pedía 18 secciones, cada una una vuelta entera | `TOPE_ENTERO` 15.000 y `seccion` con varias separadas por coma |
| Dos agentes "arreglan" un documento sano con nueve llamadas fallidas y una reescritura | el índice salía de `bloques()`: 18 encabezados anunciados como 23, títulos repetidos y un `## Resumen ejecutivo` que el documento no tenía | índice por `secciones()`: encabezados reales, nivel conservado, recorte literal |
| Una lección falsa ("edit_artifact está rota") en todas las corridas | la memoria aceptaba conclusiones sin evidencia y el prompt decía "dalo por válido" | `record_lesson` exige evidencia; refutar sin borrar ([[ADR-015 Una lección exige evidencia y refutar no borra]]) |
| La memoria es el 19% del gasto de una corrida | tres respuestas a consultas guardadas enteras, hasta 5.570 caracteres | tope por tamaño (`TOPE_MEMORIA` 3.200, `TOPE_LECCION` 400) |
| 58 ToolSearch en una corrida de Claude Code | con las herramientas del org diferidas, el CLI cargaba cada esquema con una vuelta entera | `ENABLE_TOOL_SEARCH=false` en `entornoDelCli` |
| Un turno delegado se corta y no queda ni un resumen | la salida del CLI llega al final; 31 llamadas útiles perdidas a los diez minutos | rescate del texto con `AVISO_DE_CORTE`; opencode con 20 min (`OPENCODE_TIMEOUT_MS`) |
| Un turno falla "sin resumen" con el trabajo hecho, y el siguiente escala a un modelo más caro | el CLI terminó con `is_error` tras 27 llamadas buenas | `ultimoTextoDeAsistente` rescata lo último del agente (ignora `<synthetic>`) |
| 45 de 65 minutos en huecos de quince minutos exactos | API saturada ("high demand for Opus") con diez reintentos del CLI | `--fallback-model`, `CLAUDE_CODE_MAX_RETRIES=4`, vigilante de silencio de 180 s |
| `claude -p` factura por API y el costo dice 0 | encontraba `ANTHROPIC_API_KEY` en el entorno | `entornoDelCli` la saca |
| Un programador que sólo usa `Edit` deja de ser convocado | el CLI no devuelve `tool_calls`: su turno contaba cero herramientas | `herramientasPropiasDelCli` + `alEjecutar` del puente |
| El CEO en `cheap` se va a descargar PDFs al azar | el modelo más barato no sabe coordinar | `standard` como mínimo para quien coordina |
| `standard` y `smart` resuelven al mismo modelo; o un turno de US$60/MTok | bandas sin piso o sin techo | bandas disjuntas ([[ADR-004 Bandas de precio disjuntas]]) |
| El costo real es 4× el calculado; el caché no pega | OpenRouter reparte entre upstreams; el precio del catálogo es el del más barato | `provider.sort: "price"` + `require_parameters` y `usage.include` (`openrouter.ts`) |
| Una corrida muere en el tercer ciclo sin producir | cuenta sin crédito: **402 a todo**, incluso a los modelos `:free` | `npm run check:llm` antes de una corrida larga |
| `claude-sesion` rechaza un token válido | falta el beta `oauth-2025-04-20`; o una `ANTHROPIC_API_KEY` vacía gana la cadena y autentica en blanco | `buildRegistry` manda el beta y borra la key vacía del entorno |
| opencode no encuentra el modelo `opencode/opencode/…` | se re-prefijaba un slug que ya viene namespaceado | los slugs de `opencode models` se guardan tal cual (`normalizarSlug`) |
| Corridas bajo plan cortadas por presupuesto | opencode reporta costo aunque el plan no cobre por uso | no se reporta salvo `ORQ_OPENCODE_COSTO=1` |

## Agentes y coordinación

| Síntoma | Causa | Defensa |
|---|---|---|
| Un auditor "corrige" una fecha correcta y el corrector corrompe el dato | los agentes no sabían en qué año estaban | `TurnDeps.fechaHoy`, formateada desde el llamador |
| El revisor en `free` aprueba "sin correcciones" citando frases inventadas | un verificador sin datos contra los cuales verificar inventa | darle las fuentes y el chequeo cruzado; un verificador no va en `free` |
| Diez mensajes a la misma persona | pedido, recordatorio, seguimiento, escalamiento sobre lo mismo | `send_message` rechaza insistirle a quien no contestó |
| Nadie puede contestarle a la persona (14 de 25 `reply` fallidos) | el encargo es de tipo `human` y `reply` exigía `request` o `escalation` | el turno contesta el primer pedido o, si no hay, el primer mensaje |
| El agente vuelve a preguntar lo mismo al ciclo siguiente | toda respuesta a `request_context` salía como "Aprobación concedida" | una pregunta se contesta con una respuesta, no con un permiso |
| El entregable partido en `-ciclo3`, `_v2`, `-final`, `-detalle` | los modelos baratos fragmentan | guardia de claves variante en `write_artifact` (no detecta prefijos: `informe-x` contra `x`) |
| Un equipo que se multiplica solo | cada especialista descubre que le falta otro | sólo convoca `executive`, el convocado nace `executor`, tope 4 por corrida |
| Un especialista gasta su primer turno buscando una herramienta | se le prometió algo que no existe en el catálogo | la faltante se nombra en la respuesta |
| La realizadora informa "76 segundos" y el video dura 131 | repetía el mensaje de su propia exportación | `inspeccionar_medio` mide el archivo (y avisa fuerte si no tiene audio) |
| Un servidor MCP aprobado cuyas tools no usa nadie | las descubiertas no se otorgaban o la corrida congeló su catálogo | se otorgan al solicitante e `incorporarHerramienta` + `updateRoleTools` en vivo |
| Brave instalado desde la tienda, `ready`, cero invocaciones | el rol editado no llegaba al catálogo de la corrida viva; además la tienda instala sin otorgar | `actualizarRolEnCorridasVivas`; después de instalar, asignar las tools |
| Un rol viejo no se entera de su herramienta nueva | el prompt de un rol se guarda al crearlo | cuándo usarla va en el resumen de código de cada turno (`bloqueDeTelefono`); el Mejorador se pone al día en `startRun` |
| SQL en vivo que nadie puede reproducir, o una migración que nunca se aplica | un cambio de esquema tiene dos mitades | `bloqueDeBaseDeDatos`: archivo en el repo **y** `apply_migration` |
| Una migración aprobada nunca se aplica | aprobar sólo avisaba; volver a llamar pedía aprobación otra vez | aprobar ejecuta ([[ADR-014 Aprobar una herramienta la ejecuta]]) |
| Un equipo escribe un programa en la salida y llama 36 veces a `listar_repositorios` | no había repo ni forma de crearlo | `crear_repositorio` y el resumen de turno con `dir: null` |

## Herramientas, MCP y salida

| Síntoma | Causa | Defensa |
|---|---|---|
| Un agente sin su propia `export_pdf` | 15 de coordinación competían por los lugares del ranking | el router acota sólo las opcionales |
| "No encuentro `export_video`" | el seed y las empresas nuevas no registraban habilidades | `sembrarHerramientas` y el seed con `capability` + `skill` |
| Una compuesta que existe pero no ejecuta nada | `persistMcpTools` la re-guardaba desde `describe()`, sin composición | se saltean las `creada` |
| Un servidor fantasma en `ready` en el Hub | `McpBridge.disconnect` no publica un último estado | `mcpHealth` y la UI filtran por lo configurado |
| Herramientas fantasma y roles apuntando a ids muertos | borrar un servidor MCP no cascadeaba | disconnect + `deleteToolsByMcpServer` + `podarToolIdsHuerfanos` |
| MCP no se usaba: no había cómo agregar un servidor sin `curl` | faltaban métodos en `api.ts` y formulario en el Hub | pegar `{"mcpServers": …}` (`parsearConfigMcp`) y la tienda |
| Un servidor arranca sin credencial y falla lejos de su causa | el JSON del ecosistema trae el secreto literal | se descarta **con aviso**; `envRequeridas` de la tienda lo dice al instalar |
| La segunda búsqueda del mismo segundo recibe 429 | la fila de un servidor MCP serializa pero no espacia | reintento dentro de la fila, respetando `retry-after` acotado, dos veces (`bridge.ts`) |
| Un turno cuelga para siempre esperando imágenes | el endpoint de NVIDIA acepta la conexión y no contesta | `CORTE_MS` (90 s) en `imagenes.ts`; corte en toda llamada de red |
| Consultar una empresa borrada la vuelve a crear en disco | `ExportStore.dirFor` crea al pasar | medir con `pathFor` |
| El barrido anuncia 1 fila y borra 3 | no contaba la corrida huérfana ni sus mensajes | comparar contra las corridas que van a sobrevivir; test que lo fija |
| Vaciar la salida se lleva el logo | criterio por extensión | criterio por manifiesto de procedencia |
| Después de purgar, la base pesa lo mismo | falta compactar | `VACUUM` al final, fuera de la transacción |
| Tres PDFs del mismo documento | el nombre llevaba `-vN` | un archivo por entregable y formato; se borran los `key-vN` |
| "Borrá toda la multimedia" falla a la mitad | un borrado por archivo encadenado | `delete_files` con `kind` |
| El resumen de proyectos se come la memoria, o pierde los proyectos vacíos | traer filas para contarlas; `GROUP BY` a secas | `GROUP BY` que parte de `listCompanies` |
| El proyecto renombrado abre un vault vacío | el vault se resuelve por nombre | `ContextoStore.renombrar` dentro de `Runtime.renombrarEmpresa` |
| `git status` falla dentro de la sesión después de renombrar | git anota rutas absolutas del worktree | `git worktree repair` al mudar (`repararWorktrees`) |
| Un MCP escribe en una carpeta que ya no existe | tenía la salida vieja en sus argumentos (`--output-dir`) | `reescribirRutasMcp` al migrar y al renombrar |
| Obsidian conserva una lección borrada | la baja no espejaba al vault | `espejarAprendizajes` en alta, edición y baja; tema vacío se borra |
| El vault es un bloque de texto sin esquema en Obsidian | faltaban líneas en blanco antes de `##`, frontmatter y enlaces | `notaDeAprendizajes` (de 20 a 258 enlaces) |
| La vista previa descarga el PDF en vez de dibujarlo | un `attachment` dentro de un iframe | `?inline` |
| Una tabla de Word previsualizada sale una celda por renglón | se descartaba el `</w:p>` de celda después de los genéricos | descartarlo antes |

## Documentos

| Síntoma | Causa | Defensa |
|---|---|---|
| El pie duplica el documento: una página de más por página | pdfkit agrega una página al escribir debajo del margen inferior | se baja `page.margins.bottom` mientras se dibuja el pie (`render.ts`) |
| Cada negrita parte el párrafo | posición y ancho en cada tramo `continued` | sólo en el primer tramo |
| "✅ Sí" sale como `' Sí` | las fuentes estándar usan WinAnsi | `sinEmoji` |
| Palabras partidas al medio en las tablas | el reparto proporcional ignora la palabra más larga | ancho mínimo por columna |
| Media tabla maquetada y el resto con pipes a la vista | una línea en blanco entre grupos cortaba la tabla | no termina la tabla |
| Un documento titulado "Ciclo 2" o un muro de texto | el agente escribía sobre su proceso | `revisarCalidad` rechaza |

## Guion, video y audio

| Síntoma | Causa | Defensa |
|---|---|---|
| El primero que habla dice las cuatro intervenciones, leyendo los nombres de los demás | un diálogo sin renglones en blanco es **un solo párrafo** | `parseGuion` lo vuelve a partir por cada `**Nombre:**` |
| El texto se desborda por abajo del cuadro | no había paginado | lo que no entra en el alto útil pasa de página |
| El texto alineado a la izquierda se ve apagado | la viñeta de ffmpeg apaga los bordes | no se usa |
| La portada anuncia "(v4)" y el título real queda como placa del medio | un encabezado de documento arriba del guion | el primer `#` sin cuerpo no pisa el título; un segundo `#` sin cuerpo pisa, con cuerpo abre escena |
| El video dice ":objetivo:" en voz alta | la marca de ícono sola en su renglón es un párrafo = voz en off | un párrafo que es sólo una marca conocida es el ícono de la escena (una desconocida sí se dice, para que se note) |
| El video arranca leyendo "Personajes:", "Tono:" | texto suelto entre el `#` y la primera `##` es narración de portada | el motor lo avisa fuerte en el resultado |
| Un candado que es una mancha, o parece un bolso | ASS rellena non-zero: agujero sin contorno invertido; contornos superpuestos | contorno invertido y sin solapes (`iconos.ts`) |
| La persona del visual no aparece | sobrevivió una `M` en `trazoAAss` y libass descarta el dibujo entero | sólo `M/L/C` en SVG, traducidos a `m/l/b` |
| Los rótulos caen un renglón abajo de su caja | en SVG la `y` es la línea de base; en ASS, el techo | restar un cuerpo (`visualAss`) |
| La frase se sale del globo | el corte se pasaba a ojo en caracteres | el globo calcula su propio corte |
| El teléfono flota en el aire | los props están en coordenadas absolutas | mover los props con la figura |
| El acercamiento de la foto es puro reescalado | `zoompan` amplía lo que recibe | sobremuestrear antes |
| La escena recibe la imagen ya entrada | el fundido ocurría en el segundo cero del video | correrla con `setpts` |
| La cama suena a cinta acelerada | `loudnorm` devuelve 192 kHz sí o sí | `aresample` después de `loudnorm` (`sonido.ts`) |
| La música no se oye (−40 dB) | −26 LUFS más ducking `ratio=10` | ducking musical `ratio=4`, `attack` 5, `release` 300 |
| La música compite con la voz | subirla a −20 LUFS la dejó a 4-5 dB de la narración | −26 LUFS: 10-12 dB bajo la voz; se verifica renderizando con y sin música y restando |
| Una pista inaudible y otra encima de la voz con el mismo volumen | volumen fijo en vez de sonoridad | `loudnorm` a `MUSICA.lufs` |
| El video sale mudo con la pista en la carpeta | `readdir` a secas no veía subcarpetas (`Corporate/…`) | recorrido en profundidad; entre empates gana la más larga |
| Un video entero corrido una escena | clips numerados junto con la portada | `00-…` es la portada; los demás atan al ordinal de `##` |
| El corte siguiente entra antes que su voz | `trim` antes de `tpad` | `tpad` antes de `trim` (`filtroDeEscena`) |
| Dos clips para la misma escena, elegido en silencio | numeración repetida | se avisa cuál se usó (`atarClips`) |
| Once tomas repiten el login (casi seis minutos) | cada toma abría un perfil nuevo | `sesion` persistente con candado por nombre |
| Lo reconocido no era lo que filmaba la cámara | reconocer con el MCP de Playwright: otro Chrome, otra sesión, otro tamaño | `explorar_pantalla` con la misma sesión que `grabar_clip` |
| "Orquestador" se vuelve "Orque tador" | la regex `\\s+` dentro de un template literal perdió su barra | escapar barras; nada de backticks; comentarios afuera (`chrome.ts`) |
| Seis Chrome huérfanos comiéndose la memoria | `--headless=new` es un árbol de procesos | lanzar `detached` y matar el grupo |
| Una lámina no se puede filmar | bucles infinitos, `<animate>` de SMIL o pedidos a la red | reglas del kit de láminas |
| Un video "en otro idioma" | una instrucción larga en inglés arrastra la salida al inglés | cada instrucción abre declarando salida en castellano (test en `plantillas.test.ts`) |
| El nombre de la marca pronunciado mal, o "familia" reescrita | la regla de pronunciación sin corte de palabra | `pronunciacion` sólo al texto del sintetizador, por palabra entera |
| Un video de 1m32s en vez de 2m54s | se ordenó por `updatedAt`, que los entregables no tienen, y se filmó un guion viejo | la última versión se elige por `version` |

## Código

| Síntoma | Causa | Defensa |
|---|---|---|
| Hooks de la persona disparados, refs ajenas en su repo | `git worktree add` directo sobre su `.git` | clon gestionado ([[ADR-009 Programar sobre un clon gestionado y un worktree]]) |
| Los `.env` en el commit base, legibles por un agente | sin exclusiones | `.git/info/exclude` (`EXCLUIDOS`) |
| El orquestador clonado adentro de sí mismo | se clonaba el repo que contenía la carpeta | una subcarpeta se copia sola |
| Un simulador de tres etapas perdido al sacar el repo | vivía sólo en la rama de la sesión | respaldo `bundle` + `patch` en `respaldos/` |
| `vitest` y `jest` no terminan nunca | arrancan en watch sin `CI=1` | `entornoDeComando` fija `CI=1` |
| Procesos nietos corriendo después del corte | se mataba sólo al primer proceso | kill al grupo (`detached`) |
| El ciclo corregir → testear se frena a la tercera | `exit ≠ 0` contaba como fallo idéntico | `exit ≠ 0` es `ok: true` |
| 24 `npm test` sobre el mismo código | tres roles verificando lo mismo | caché por huella del árbol, 30 min |
| Un checkpoint falla con "index.lock: File exists" | el IDE pide `git status` cada 3 s y toma el lock | `GIT_OPTIONAL_LOCKS=0` y reintento |
| Buscar en la sesión devuelve archivos del orquestador | `git grep --untracked` con `--work-tree` y sin `cwd` | `cwd` = worktree por defecto (`git.ts`); `vitest.config.ts` excluye `data/` |
| `git stash` falla con "not uptodate" | `--intent-to-add` marca los archivos nuevos | `soltarIntencionDeAgregar` antes de stash o cambio de rama |
| Un `main` de la persona reescrito | `+rama:rama` usado para ramas propias | `integrarRamaPropia` sólo avanza |
| Marcas de conflicto commiteadas como código | una fusión con conflicto quedaba abierta | se aborta y nombra los archivos |
| Un simulador 3D sin dibujar | el código importaba Three.js y nadie podía instalarlo | `instalar_dependencia`: aprobar instala |
| El backend de INSPIA muere con "require is not defined" | `data/` hereda `"type": "module"` del orquestador | `data/proyectos/package.json` `commonjs` (`Directorios.prepararRaiz`) |
| El frontend de la vista previa le habla al backend de la persona | URLs `localhost:<puerto original>` en los `.env` | `redirigirUrlsLocales` y puertos reservados |
| Expo se arranca con el comando de Vite | clasificado como web por traer `react-dom` | Expo gana a Vite (`clasificarServicio`) |
| Puertos ocupados por servicios huérfanos | un reinicio de `tsx watch` los dejaba vivos | `.servicios-vivos.json` (pid + inicio) y barrido al arrancar |
| El HTML de la vista previa se descarta | `transfer-encoding` junto a `content-length` al reescribir | se saca (`proxy-vista.ts`) |
| La página sale sin selector | un 304 devolvía la versión guardada | no se reenvían pedidos condicionales de HTML |
| El servicio "listo" sin haber arrancado | la salud se pedía al proxy, que contesta 502 | la salud va al puerto interno |
| Se pierde el error que tira la app al arrancar | el inspector se cargaba tarde | se inyecta al principio del `<head>`, sin `defer` |
| `tsc` rechaza `inspector.ts` | choca con `Inspector.tsx` en un sistema de archivos sin mayúsculas | los tipos viven en `sonda.ts` |
| Abrir el chat corre la página entera de costado | grilla con columna `auto` implícita y Monaco de 16M px | `grid-cols-[minmax(0,1fr)]` |
| El checkpoint del agente se lleva el trabajo de la persona | con `commitsAutomaticos` prendido, lo editado en el IDE iba en el commit del agente | se commitea a su nombre antes del turno (`abrirTurnoDeCodigo`) |

## Móvil

| Síntoma | Causa | Defensa |
|---|---|---|
| La app sin Metro ni API después de bloquear el teléfono | cada reconexión de adb es otra conexión; los túneles `reverse` son de la conexión | se recuerda qué app se abrió (`.dispositivos.json`) y se re-tienden al cambiar serial + `transport_id` |
| La vista parece viva y está congelada | un `<img>` sobre multipart se queda con el último cuadro | leer con `fetch` y mostrar "reconectando" |
| El espejo no suelta ni un cuadro | `-fflags nobuffer` | no se usa |
| El codificador JPEG rechaza el video | el H.264 del teléfono viene en rango limitado | `-pix_fmt yuvj420p` |
| La captura sigue grabando después de cerrar | se escuchaba el `close` del pedido | el `close` de la respuesta |
| "corrupt decoded frame" por Wi-Fi | el AUD por silencio partía cuadros | scrcpy ([[ADR-019 El espejo del teléfono es scrcpy con respaldo]]) |
| El servidor de scrcpy se cae | `RESET_VIDEO` antes de que exista la captura (NPE en 4.1) | sólo para espectadores que llegan tarde |
| Se pierde el códec del video | el socket fluía sin lector | en pausa hasta tener lector |
| `pm list packages` falla con "user 150" | Samsung con carpeta segura | todo con `--user current` |
| La app usa la cámara del sistema aunque se instaló expo-camera | se compilaba el `android/` viejo | reinstalar siempre pasa por `expo prebuild` |
| `logcat --uid` no devuelve nada | no lee el buffer principal | `-v uid` filtrado en el servidor (`lineasDeLaApp`) |
| No aparece el `console.log` de la app | en la arquitectura nueva no pasa por logcat | `ConsolaJs` por el depurador de Hermes |
| Un crash ilegible | la cola del tombstone son cien marcos de libart | el crash se muestra desde su comienzo |
| La captura sale negra | pantalla apagada (`Dozing`): la app se desconecta de Metro | el estado lo dice y la captura se niega |
| Un toque cae en otro botón | coordenadas fijas y la pantalla corrida por un banner o el teclado | QA por texto (`manejar_app`) |
| Una espera que no respeta los segundos | se contaba en vueltas y leer la pantalla es lento | `esperar_texto` por reloj |
| `keytool` contesta "Propietario" | idioma de la máquina | `-J-Duser.language=en` |
| `aapt2 dump` no lee el manifiesto de un AAB | está en protobuf | `parsearManifiestoProto` |
| Un APK bien firmado figura "no firmado" | la firma v2/v3 no la ve `keytool -jarfile` | `apksigner verify --print-certs` |
| Un `127.0.0.1` horneado en producción | `.env.prod` pasado por la reescritura de la vista previa | `.env.prod` entra sólo al proceso del build, sin reescribir |
| Play rechaza el build siguiente | se borró el último build, referencia de `versionCode` y certificado | el más reciente no se borra |

## Interfaz

| Síntoma | Causa | Defensa |
|---|---|---|
| El organigrama invisible: nodos en el DOM, ninguno en pantalla | objetos nuevos en cada render; React Flow pierde la medición | `OrgGraph` reusa con `useNodesState` |
| Todos los DELETE contestan 400 | `content-type: application/json` con cuerpo vacío | `api.ts` sólo lo pone con cuerpo |
| La página desborda a lo ancho | `min-width: auto` en ítems de grilla | `min-w-0` en `Panel` y columnas |
| La pantalla queda "cargando" un proyecto borrado | la referencia al proyecto no se soltaba | la navegación vive en la URL: al borrar se navega a `/proyectos` |
| La carga parpadea en tema oscuro | el tema se aplicaba después del primer pintado | se aplica en `index.html` antes de pintar |
| Ir a Buscar y volver cierra todas las carpetas | las vistas laterales del IDE se desmontaban | quedan montadas y se ocultan |

## Entorno

| Síntoma | Causa | Defensa |
|---|---|---|
| Rutas recién agregadas dan 404 | un proceso viejo sigue en el 3001 | `lsof -ti:3001 \| xargs kill -9`; Vite usa `strictPort` |
| El aviso de `npm audit` sobre `@hono/node-server` | llega por el SDK de MCP; no es alcanzable (sólo el lado cliente) | **no lo "arregles"** sin leer `package.json` → `auditNotes` |

## Ver también

- [[Invariantes de arquitectura]] — las reglas que salieron de acá
- [[Diagnóstico de problemas]] — por síntoma
- [[Pruebas y calidad]] — qué test vigila cada una
- [[Decisiones de arquitectura]]
