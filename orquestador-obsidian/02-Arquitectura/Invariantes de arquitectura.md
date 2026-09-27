---
tags: [arquitectura]
aliases: [Invariantes, Reglas que no se rompen, Reglas de arquitectura]
---

# Invariantes de arquitectura

Las reglas que no se ven leyendo un solo archivo. Romper cualquiera produce un
bug que cuesta caro encontrar: la mayoría están acá **porque ya pasó**. Cada
fila dice por qué existe, **dónde la hace cumplir el código** y **qué test la
fija**. Cuando dice "sin test propio", la regla vive sólo en el código y en esta
nota: ahí es donde más fácil se rompe.

Para el síntoma que produce cada una al romperse, ver [[Trampas conocidas]]. Para
las decisiones de las que salen, [[Decisiones de arquitectura]].

> [!tip] Un principio que atraviesa todo
> **Los frenos viven en el ejecutor, no en el prompt.** Un agente puede ignorar
> una instrucción; no puede saltearse el código que ejecuta su herramienta. Casi
> todas las reglas de abajo son una aplicación de esto.

## 1. Estructura y dependencias

| # | Regla | Por qué | Dónde se hace cumplir | Qué lo fija |
|---|---|---|---|---|
| 1.1 | **Zod es la única fuente de verdad.** Un campo nuevo entra primero en `packages/shared/src/schema.ts`; servidor y UI infieren de ahí | el tipo del cliente y la validación del servidor no pueden divergir | `schema.ts`; validación con `safeParse` en `apps/server/src/routes.ts` | `npm run typecheck` ([[ADR-002 Zod como única fuente de verdad]]) |
| 1.2 | **Los enums no se copian a mano.** Un enum del dominio que usa otro esquema se importa | el tipo de solicitud copiado en `events.ts` parseaba en la base y rompía el evento que la anunciaba | `events.ts` → `agentRequestEvent.requestType` reusa `agentRequestTypeSchema` | typecheck |
| 1.3 | **El motor no conoce al servidor**: `packages/engine` no importa Fastify ni SQLite; recibe `LlmProvider` y `Persistence` inyectados | los tests corren con `FakeProvider` y `noPersistence`, sin tokens ni disco | `packages/engine/package.json` (deps: `@orq/llm`, `@orq/tools`, `@orq/shared` y el SDK de MCP para el puente) | toda la suite de `packages/engine` ([[ADR-003 Motor desacoplado del servidor]]) |
| 1.4 | **Lo que el motor no puede saber, se inyecta**: la fecha (`fechaHoy`), el directorio de salida (`dirDeTrabajo`), el mapa de contexto, el espacio de código | sin reloj los tests son deterministas; sin fecha un auditor "corrigió" un año correcto | `TurnDeps` y `OrchestratorDeps` en `loop.ts` / `scheduler.ts` | `memory.test.ts`, `loop.test.ts` (sin fecha → determinista) |
| 1.5 | **El render no tiene reloj**: la fecha de un documento entra formateada | tests deterministas | `skills/index.ts` → `crearSkill` arma `date` desde `artifact.createdAt`; `render.ts` no llama a `Date` | `skills.test.ts` → "archivos generados" |
| 1.6 | **`packages/tools` no decide dónde van los archivos ni lee el disco**: recibe `SkillStorage`, `resolverImagen`, `CodigoStorage`, `FabricaOAuth` del servidor | quien sanea la ruta que propone un modelo es el servidor | `skills/index.ts` → `SkillStorage`; `apps/server/src/exports.ts` → `ExportStore.forCompany` | `skills.test.ts`, `exports.test.ts` |
| 1.7 | **Los `packages/` no se compilan**: `exports` apunta a `./src/index.ts`; `tsc --build` sólo emite declaraciones (`emitDeclarationOnly`) a `dist/`, que está en `.gitignore` | un paso de build sin necesidad es costo puro | `packages/*/package.json`, `packages/*/tsconfig.json` | — |
| 1.8 | **Una regla, una copia.** Lo que dos lados deciden vive en `@orq/shared`: `argv.ts`, `dependencias.ts`, `esCorridaTerminal`, `normalizarLeccion`, `servicios.ts`, `programacion.ts`, `mcp-config.ts` | con dos copias, lo que una aceptaba la otra rechazaba | `packages/shared/src/*` | los `*.test.ts` de `packages/shared` |
| 1.9 | **El dominio es una empresa**: "proyecto" es el rótulo de una pantalla, no una entidad | sin la metáfora organizacional el organigrama no significa nada | `Company` en `schema.ts`; `Proyectos.tsx` sólo rotula | — |

## 2. El motor y la corrida

| # | Regla | Por qué | Dónde se hace cumplir | Qué lo fija |
|---|---|---|---|---|
| 2.1 | **El actor se ata por turno, no se guarda.** Nunca estado mutable por turno en `RunState` | con turnos en paralelo un agente pisaba al otro y los mensajes quedaban firmados por el rol equivocado | `RunState.forActor` (closure) en `state.ts` | `scheduler.test.ts` → "cada mensaje queda atribuido a quien realmente lo envió" (4 agentes) |
| 2.2 | **Todo lo que pasa emite un evento** | un paso sin evento es invisible; la UI deriva todo de la traza | `EventBus.emit` (`engine/src/events.ts`); variantes en `shared/src/events.ts` | typecheck (unión discriminada) |
| 2.3 | **`agent.turn_end` se emite en `finally`**, y el espacio de código se cierra en el mismo `finally` | si un turno falla sin cerrarlo, el nodo queda "pensando…" para siempre y el arriendo no se suelta | `runAgentTurn` (`loop.ts`) | `memory.test.ts` → "un turno que falla igual emite turn_end…"; `loop.test.ts` → "cierra aunque el proveedor falle" |
| 2.4 | **Nadie corre dos veces por tick**, y el trabajo fluye en el mismo ciclo a quien no corrió | cota contra el ping-pong sin pagar un ciclo por eslabón | `Orchestrator.correrCadena` | `continuidad.test.ts` → "dos agentes que se escriben sin parar corren una vez cada uno"; `scheduler.test.ts` → "la cadena completa avanza en un solo ciclo" ([[ADR-016 El ciclo es una cadena]]) |
| 2.5 | **El orden del ciclo lo da la urgencia**: pedidos sin contestar ×10, bandeja, tareas, fallos −4, estable ante empates | con concurrencia acotada, el orden decide el ciclo | `ordenarPorUrgencia` | `continuidad.test.ts` → "a quién se atiende primero" |
| 2.6 | **`AGENT_CONCURRENCY` es un techo** | seis turnos delegados a la vez fallaban todos juntos | `runTurns` (`Math.min(concurrency, roleIds.length)`) | — |
| 2.7 | **El fallo de un agente no tumba la corrida; el presupuesto sí** | un proveedor saturado es "alguien que no vino hoy"; el presupuesto es un límite de la corrida | `runTurns` (atrapa todo menos `BudgetExceededError`) | `memory.test.ts` → "un agente que falla no tumba la corrida"; `scheduler.test.ts` → "corta la corrida cuando se agota el presupuesto" |
| 2.8 | **Tres ciclos sin un turno bueno cortan la corrida**, con espera creciente entre ciclos fallidos (30/60/120 s) | una cuenta sin crédito quemaba los 50 ciclos en un minuto | `TICKS_FALLIDOS_TOLERADOS`, `ESPERA_BASE_MS` (`ORQ_ESPERA_PROVEEDOR_MS`) | `scheduler.test.ts` → "corta la corrida cuando el proveedor rechaza todos los turnos…" |
| 2.9 | **Una corrida vacía no es un éxito**: sin entregable, sin mensajes entre roles, sin código editado y sin consulta respondida → `failed` | un "completed" en dos ciclos sin nada se leía como éxito barato | `tick()` → `escribioCodigo`, `respondio`, `mensajesEntreRoles` | `scheduler.test.ts` → "no informa éxito cuando nadie produjo nada", "un pedido de código que editó…", "una consulta del chat que trabajó y respondió…" |
| 2.10 | **Antes de cerrar, el executive confirma** (una vez por corrida) | una corrida cerraba con la primera etapa hecha | `tick()` → `cierrePedido` | — |
| 2.11 | **Hablar sin hacer nada deja de convocar**: dos turnos sin herramientas y el rol no se convoca por tareas hasta un mensaje nuevo | catorce ciclos de livelock medidos | `turnosSinHacerNada`, `TURNOS_VACIOS_TOLERADOS` = 2 | `scheduler.test.ts` → "deja de convocar al que habla sin hacer nada…" |
| 2.12 | **Los pedidos sin respuesta se reencolan** (dos reenvíos y se abandona) | leer un mensaje lo saca de la bandeja y el pedido desaparecía | `RunState.reencolarSolicitudesSinResponder` | `state.test.ts` → "los reencola y deja de insistir después del tope" |
| 2.13 | **Pausar es un pedido**: `pauseRequested`, efectivo al cerrar el ciclo; avanzar lo limpia | en modo continuo el bucle arrancaba el siguiente ciclo igual | `Orchestrator.pause`, `runContinuous`, `tick` | `scheduler.test.ts` → "pausar frena el modo continuo y después se puede continuar" |
| 2.14 | **`awaiting_approval` no se pisa con `paused`**, y se destraba sola si ya no hay nada pendiente | su motivo es lo único que explica por qué no avanza | `pause`, `runContinuous` (`esperaAlgo`) | `scheduler.test.ts` → "retoma cuando la solicitud queda resuelta" |
| 2.15 | **Contestar reanuda**: resolver una solicitud o aprobación reanuda la corrida si esperaba | aprobar sin efecto visible obligaba a "continuar" a mano | `Runtime.reanudarSiEsperaba` | `scheduler.test.ts` → "queda esperando en vez de terminar…" |
| 2.16 | **Qué corrida se puede continuar es una sola lista**: `esCorridaTerminal` | la UI trataba `awaiting_approval` como terminada y ofrecía borrarla | `schema.ts` → `ESTADOS_TERMINALES`; `Runtime.sePuedeContinuar` | sin test propio |
| 2.17 | **El estado autoritativo es `orchestrator.snapshot`**, no `active.run` | una corrida detenida decía "está en curso" | `Runtime.estaViva`, `sePuedeContinuar` | sin test propio |
| 2.18 | **El trabajo abierto sobrevive a su corrida; lo terminado no vuelve** | un encargo largo arrancaba de cero | `listTasksAbiertasByCompany` + `RunState` (adopción, `heredadaDeRunId`) | `continuidad.test.ts` → "tareas heredadas…"; `db.test.ts` → "trabajo abierto de la empresa" |
| 2.19 | **Lo que editás en la configuración llega a la corrida viva** (incorporando al catálogo antes de otorgar) | Brave instalado y otorgado, cero invocaciones: la corrida no lo tenía en catálogo | `Runtime.actualizarRolEnCorridasVivas`, `RunState.incorporarHerramienta` | `roles-vivos.test.ts` |
| 2.20 | **Aprobar ejecuta la llamada aprobada** con sus argumentos | aprobar sólo avisaba y la herramienta volvía a pedir aprobación | `Orchestrator.ejecutarAprobada` | `scheduler.test.ts` → "aprobaciones" ([[ADR-014 Aprobar una herramienta la ejecuta]]) |
| 2.21 | **Toda llamada al modelo lleva corte y reintento** (120 s por defecto, o el del proveedor; 4 intentos con backoff) | una llamada de 649 s dejó a tres agentes esperando once minutos | `withRetry`, `conTimeout`, `TurnDeps.llmTimeoutMs`, `LlmProvider.timeoutMs` | `loop.test.ts` → "una llamada lenta no puede bloquear el ciclo" |
| 2.22 | **El loop corta al que repite una llamada fallida**: 3 idénticas o 5 por el mismo motivo | un error irresoluble comía las `maxTurns` enteras | `TOLERANCIA_IDENTICA`, `TOLERANCIA_MOTIVO` en `loop.ts` y en `claude-mcp.ts` | `loop.test.ts` → "agente atascado en la misma llamada fallida" |
| 2.23 | **Un turno cortado continúa, no reempieza** | la conversación ya tenía la bandeja leída y las fuentes consultadas | `RunState.tomarTurnoInterrumpido`, `podarSinRespuesta` | `loop.test.ts` → "un turno cortado continúa, no reempieza" |
| 2.24 | **Las iteraciones se presupuestan por carga**; `maxTurns` es el piso, techo ≤ 50 | un tope fijo sobra en un caso y corta en otro | `presupuestoDeIteraciones` | `loop.test.ts` → "presupuesto dinámico de iteraciones" |

## 3. Contexto y costo

| # | Regla | Por qué | Dónde se hace cumplir | Qué lo fija |
|---|---|---|---|---|
| 3.1 | **El memo de lecturas es por turno** y su huella usa **sólo los argumentos declarados** cuando el esquema cierra con `additionalProperties: false` | un `start=4000` inventado hacía que el mismo documento entrara once veces (534k tokens de entrada, 2k de salida) | `huellaDeLectura`, `clavesDeCache` | `loop.test.ts` → "no se deja engañar por un argumento inventado…" |
| 3.2 | **Escribir invalida el memo**, en el loop y en el puente delegado (misma función) | leer → editar → leer devolvía el puntero a la versión vieja | `invalidarMemo` (`loop.ts`, usada por `claude-mcp.ts`) | `loop.test.ts` → "pero escribir sí lo invalida…"; `claude-mcp.test.ts` → "después de una escritura, releer devuelve el contenido nuevo" |
| 3.3 | **El memo no se extiende entre turnos** | la conversación del CLI se reinicia; un puntero ahí apunta a la nada | memo local de cada turno | — |
| 3.4 | **La conversación del loop se compacta**: presupuesto de 14.000 tokens, lo reciente protegido por tamaño (6.000) | el contexto crece al cuadrado | `compactarConversacion`, `PRESUPUESTO_CONTEXTO`, `TOKENS_INTOCABLES` | `loop.test.ts` → "el contexto de un turno no crece sin techo" |
| 3.5 | **Lo que entra a un turno delegado se acota en la puerta**: `TOPE_RESULTADO` = 16.000 caracteres; aviso a 50 llamadas y tope a 80 (niega lecturas, deja escrituras) | el turno delegado no tiene un "después" donde compactar | `acotar.ts`, `claude-mcp.ts` (`AVISO_DE_LARGO`, `TOPE_DE_LARGO`) | `acotar.test.ts`, `claude-mcp.test.ts` |
| 3.6 | **Al recortar, sólo se ofrecen argumentos que la herramienta declara** (`ACOTADORES`) | sugerir `start` o `page` es lo que costó los 534k | `acotarResultado` → `comoAcotar` | `acotar.test.ts` → "ofrece sólo argumentos que la herramienta declara de verdad" |
| 3.7 | **Tres números acoplados**: `TOPE_RESULTADO` (16.000), `TOPE_ENTERO` de `read_artifact` (15.000) y `LINEAS_POR_LECTURA` de `leer_codigo` (350) | mandar más que el tope es mandar algo que llega cortado | `acotar.ts`, `coordination.ts`, `codigo/index.ts` | `busqueda.test.ts`, `coordination.test.ts` → "read_artifact: costo de leer" |
| 3.8 | **Para buscar se parte; para mostrar, no**: el índice de `read_artifact` sale de `secciones()` (encabezados reales, nivel conservado, recorte literal), nunca de `bloques()` | un informe de 18 encabezados se anunciaba como 23 secciones, con títulos fantasma | `busqueda.ts` → `secciones`, `bloques` | `busqueda.test.ts` → "secciones" |
| 3.9 | **La memoria del prompt se acota por tamaño** (3.200 caracteres, 400 por lección, hasta 25) | llegó al 54% del prompt de sistema y al 19% del gasto de una corrida | `buildMemorySection`, `TOPE_MEMORIA`, `TOPE_LECCION` | `memory.test.ts` → "acota la memoria por tamaño…" |
| 3.10 | **Lo corto se manda, lo largo se apunta**: el mapa del vault viaja (60 notas / 4.000 caracteres), el contenido no | una llamada delegada cuesta una iteración de 20-28k tokens | `ContextoStore.mapa`, `mapaDeContextoEnPrompt` | `contexto.test.ts` (ambos) ([[ADR-013 El vault de contexto se escribe por el sistema de archivos]]) |
| 3.11 | **Las bandas de precio son disjuntas** (0 / ≤1 / 1–8 / 8–25 USD/MTok) para catálogos con precio; Claude y opencode van por mapa | sin piso `standard` y `smart` coinciden; sin techo `smart` elige US$60/MTok | `tiers.ts`, `modelos-claude.ts` → `resolverTierEstatico` | `modelos-claude.test.ts` ([[ADR-004 Bandas de precio disjuntas]]) |
| 3.12 | **Un `modelSlug` fijo gana siempre**; el escalado es una función pura y monótona; **todo turno emite `model.selected`** | un costo que varía entre turnos tiene que poder explicarse | `elegirTierPorDificultad` (`dificultad.ts`), `runAgentTurn` | `dificultad.test.ts`; `loop.test.ts` → "escalado de modelo por dificultad" |
| 3.13 | **Una empresa en `free` no escala a pago**; los convocados nacen con escalado acotado por autoridad | iría derecho a un 402 | `conEscaladoPorAutoridad` (`runtime.ts`) | `loop.test.ts` → "incorporarRol nace con escalado activo acotado a executor" |
| 3.14 | **El presupuesto se evalúa antes de cada turno y de cada iteración** | es el único freno de gasto | `ledger.assertWithinBudget` en `runAgentTurn` | `ledger.test.ts` → "el presupuesto corta con el costo real" |
| 3.15 | **El costo real manda sobre el catálogo** (`reportedCostUsd`); un costo informado de cero es cero | el catálogo de OpenRouter subestimaba hasta 4× | `computeCost` (`ledger.ts`) | `ledger.test.ts` |

## 4. Herramientas y permisos

| # | Regla | Por qué | Dónde se hace cumplir | Qué lo fija |
|---|---|---|---|---|
| 4.1 | **Las de coordinación se otorgan siempre**; `toolIds` controla `capability`, `skill`, `mcp` y `creada`. En la UI no se presentan como quitables | sin ellas un agente no puede hablar con nadie | `ToolRegistry.forRole` | indirecto: los roles de prueba (`testing/factory.ts`) nacen con `toolIds: []` y coordinan |
| 4.2 | **Una habilidad no se otorga sola**: toda empresa siembra sus filas de `capability` y `skill` | sin filas en `tools`, `toolIds` no apunta a nada | `Runtime.sembrarHerramientas` (en `POST /api/companies` y `generarEquipo`); `seed.ts` | `equipo.test.ts` → "las habilidades quedaron incluidas" |
| 4.3 | **La herramienta que no se puede cumplir no se registra** (imágenes sin key, navegador, adb). Excepción consciente: código y R2 se registran siempre y dicen qué falta | ofrecer algo que siempre falla hace gastar turnos | `createSkillTools`, `registrarCodigoEn` | `skills.test.ts` → "el motor de estudio se registra sólo si hay navegador"; `equipo.test.ts` → "el equipo de software recibe las herramientas de código aunque todavía no haya repo" |
| 4.4 | **El router acota las opcionales, no el total**: coordinación, habilidades y creadas se exponen siempre | 15 de coordinación dejaban 5 lugares para 20, y un agente perdía su `export_pdf` | `router.ts` → `isAlwaysExposed` (umbral 25, límite 12) | `router.test.ts` (coordinación y habilidades; las creadas, sin test propio) |
| 4.5 | **Las habilidades reciben la clave de un entregable, nunca el contenido** | un documento largo por argumento se trunca al agotar `max_tokens` | `buscarEntregable` | `guion.test.ts`, `skills.test.ts` → "cuando la clave no existe, dice cuáles hay" ([[ADR-005 Las habilidades trabajan sobre entregables ya escritos]]) |
| 4.6 | **La jerarquía se valida en código** (a quién se asigna, quién mueve una tarea) | un agente puede ignorar el prompt | `assign_task`, `update_task` en `coordination.ts` | `scheduler.test.ts` → "respeta la jerarquía…"; `coordination.test.ts` → "update_task: cada uno mueve sólo lo suyo" |
| 4.7 | **Insistir no está permitido**: no se le escribe de nuevo a quien no contestó | diez mensajes a la misma persona en una corrida | `send_message` (`mensajesSinResponder`) | `coordination.test.ts` → "send_message: uno por persona hasta que conteste" |
| 4.8 | **Un entregable parece un documento**: `write_artifact` rechaza títulos de proceso y muros de más de 400 caracteres sin secciones; y rechaza claves variante (`-ciclo3`, `_v2`, `-final`, sufijos colgados) | el render no inventa estructura; los modelos baratos fragmentan | `revisarCalidad`, guardia de `raiz()` en `write_artifact` | `coordination.test.ts` → "un solo entregable por tema", "un entregable tiene que parecer un documento" |
| 4.9 | **Nada con plata sale sin verificar**: un documento con cifras no se exporta sin `verificar_cifras` de la versión actual | el auditor verificaba una cifra de seis y se daba por satisfecho | `revisarCifras` (`skills/index.ts`) | `gate.test.ts` |
| 4.10 | **Crear y modificar es libre; borrar mira la jerarquía**: `executive` todo, `manager` sólo apoyo (no `.docx` ni `.pdf`), `executor` nada; en lote se filtra antes | un ejecutor tiene que producir sin pedir permiso | `puedeBorrar` (`skills/permisos.ts`), `crearBorrado` | `permisos.test.ts` |
| 4.11 | **Un agente sólo borra lo suyo** (multimedia o generado); sin manifiesto, todo es externo | lo que trajo una persona no lo borra un agente | `ExportStore.removeComoAgente`, `.orq-generado.json` | `exports.test.ts` → "qué puede borrar un agente" |
| 4.12 | **Toda ruta que propone un agente se sanea segmento por segmento** (salida y vault); en código, `realpath` contra el worktree y nada de `.git/**` | un modelo no puede escribir fuera de su directorio | `ExportStore.safePath`; `resolverEnWorktree` (`codigo/rutas.ts`) | `exports.test.ts` → "saneo de rutas"; `codigo.test.ts` → "resolverEnWorktree" |
| 4.13 | **Toda llamada de red que sale de una herramienta lleva corte** | un endpoint mudo cuelga la corrida | `imagenes.ts` (`CORTE_MS` 90 s), `r2.ts` (20 s), `chrome.ts` (`CORTE`), `git.ts` (60 s por defecto) | sin test propio del corte de imágenes |
| 4.14 | **`check_activity` lo graba el loop, no el agente** (últimas 500 entradas) | el error más repetido es ejecutar bien e informar que no se pudo | `RunState.recordActivity`, `check_activity` | `coordination.test.ts` → "auditar lo que los agentes hicieron" |
| 4.15 | **Convocar**: sólo `executive`; el convocado nace `executor`; tope de 4 por corrida; lo que no existe se nombra | sin frenos el equipo se multiplica solo | `convocar_especialista`, `TOPE_DE_CONVOCATORIA` | `coordination.test.ts` → "convocar_especialista" |
| 4.16 | **Compuestas**: `executive`/`manager`; sólo lo asignado; sin compuestas de compuestas; sin pasos con aprobación; ≤ 6 pasos; se corta en el paso que falla | crear no puede escalar permisos | `compuestas.ts` | `compuestas.test.ts` ([[ADR-020 Herramientas compuestas declarativas]]) |
| 4.17 | **Una lección exige evidencia**; confirmar exige otro autor u otra corrida; refutar no borra | una lección falsa degrada todas las corridas | `record_lesson`, `HABLAR_NO_ES_EVIDENCIA`, `buildMemorySection` | ver [[ADR-015 Una lección exige evidencia y refutar no borra]] |
| 4.18 | **Una sola lectura de learnings, parseada por Zod**, y una sola regla de dedupe | las filas viejas no traen `estado`; dos puertas de entrada | `Store.listLearnings`, `normalizarLeccion` | `routes.test.ts` → "compatibilidad con filas guardadas antes del esquema nuevo", "cargar dos veces la misma lección…" |

## 5. Datos, disco y persistencia

| # | Regla | Por qué | Dónde se hace cumplir | Qué lo fija |
|---|---|---|---|---|
| 5.1 | **Los entregables son de la empresa**: sobreviven a que se borre su corrida (`artifacts.company_id`) | limpiar corridas no puede costar el trabajo | `listArtifactsByCompany`, `deleteRun` | `db.test.ts` → "conserva los entregables…" |
| 5.2 | **La última versión de un entregable se elige por `version`**: no hay `updatedAt` | ordenar por un campo inexistente renderizó un guion viejo | `RunState.readArtifact`, `writeArtifact`, `listArtifacts` | `roles.test.ts` → "versiona sobre lo existente…" |
| 5.3 | **`TABLAS_POR_EMPRESA` y `TABLAS_POR_CORRIDA` se comparten** entre borrado en cascada y barrido de residuos; el barrido anuncia exactamente lo que borra | una tabla en un solo lado deja basura o se lleva filas con dueño | `db.ts` → `residuos`, `purgarResiduos` | `db.test.ts` → "anuncia exactamente las filas que va a borrar" |
| 5.4 | **Consultar el disco no lo escribe** (`pathFor` mide, `dirFor` crea; el vault y los proyectos sólo se crean al escribir) | un barrido producía los residuos que venía a buscar | `ExportStore.pathFor`, `ContextoStore.resolverDir`, `Directorios` | `exports.test.ts` → "medir no crea la carpeta…"; `directorios.test.ts` → "consultar no crea nada" |
| 5.5 | **`directorios.ts` es la única fuente de rutas**; la carpeta la encuentra la marca `.empresa`, no el nombre | renombrar no puede crear una carpeta nueva al lado | `Directorios` | `directorios.test.ts` |
| 5.6 | **Borrar una empresa toca tres lugares**: runtime (MCP vivos), base y disco | los procesos MCP no se caen por borrar filas | `Runtime.eliminarEmpresa`, `olvidarEmpresa` | `directorios.test.ts` → "borrar la empresa se lleva la carpeta entera…"; `db.test.ts` → "borrar una empresa no deja residuos" |
| 5.7 | **Borrar una corrida la suelta del runtime** | quedaba un orquestador escribiendo eventos de algo inexistente | `Runtime.olvidarCorrida` | sin test propio |
| 5.8 | **Las corridas huérfanas se cierran al arrancar** | una caída las dejaba en `running` y bloqueaba misiones | `Store.sanearCorridasHuerfanas` (en `index.ts`) | `db.test.ts` → "saneo de corridas huérfanas" |
| 5.9 | **Renombrar no es un PATCH del nombre**: muda carpeta, vault, worktrees y rutas MCP; se rechaza con corrida o servicios vivos | el vault se resuelve por nombre | `Runtime.renombrarEmpresa` | `renombrar.test.ts` |
| 5.10 | **Secretos por referencia**: MCP guarda el nombre de la variable; un literal se descarta con aviso; tokens OAuth en archivo 0600, nunca en la base; los `.env` de servicios no se copian ni se guardan; las credenciales de R2 no salen del servidor | una empresa exportada a JSON no puede llevar credenciales | `mcp-config.ts` → `referenciaDe`; `mcp-oauth.ts`; `servicios.ts`; `r2.ts` | `mcp-config.test.ts`, `tienda-mcp.test.ts`, `mcp-oauth.test.ts`, `servicios.test.ts`, `r2.test.ts` |
| 5.11 | **La lista autoritativa de servidores MCP es la base** | el mapa de salud conservaba servidores borrados | `Runtime.mcpHealth` (filtra por lo configurado); la UI filtra lo que llega por SSE | sin test propio |
| 5.12 | **Borrar un servidor MCP va en cascada**: disconnect, tools del servidor y `toolIds` huérfanos | quedaban herramientas fantasma | `Runtime` + `deleteToolsByMcpServer`, `podarToolIdsHuerfanos` | `db.test.ts` → "cascada al borrar un servidor MCP" |
| 5.13 | **Una misión guarda su próximo disparo en la base** (`proximaAt`), estrictamente posterior; una expresión inválida da `null`; en cron día-del-mes y día-de-semana son OR | un timer se pierde al reiniciar; `desde` inclusivo redispara para siempre | `programacion.ts` → `proximaCorrida`; `misiones.ts` | `programacion.test.ts` |
| 5.14 | **Una misión no larga si la empresa tiene una corrida viva** | dos equipos se pisan los entregables | `MisionScheduler` → `tieneCorridaViva` | sin test propio |
| 5.15 | **Publicar lo decide una persona**; conserva la subcarpeta y contesta 409 antes que pisar | "aprobado" es un hecho en el disco | `ExportStore.publicar` | `directorios.test.ts` → "publicar conserva la subcarpeta…" ([[ADR-008 Publicar lo decide una persona]]) |
| 5.16 | **Un archivo por entregable y formato** (`key.pdf`), y se borran los `key-vN` viejos | v1, v2 y v3 convivían | `crearSkill`, `sinVersionEnNombre` | `skills.test.ts` → "la versión no va en el nombre del archivo" |

## 6. Código

| # | Regla | Por qué | Dónde se hace cumplir | Qué lo fija |
|---|---|---|---|---|
| 6.1 | **Nunca se escribe en el `.git` de la persona**: clon gestionado + worktree | un worktree directo escribe en su `.git` y dispara sus hooks | `RepoStore.cargar`, `abrirSesion` | `repos.test.ts` → "…no escribe nada en el .git original" ([[ADR-009 Programar sobre un clon gestionado y un worktree]]) |
| 6.2 | **Los secretos no entran al clon** (`.git/info/exclude`) | el commit base se llevaba los `.env` | `EXCLUIDOS` | `repos.test.ts` → "…deja afuera .env y node_modules" |
| 6.3 | **Los agentes no commitean** (por defecto) e integrar exige árbol commiteado | la historia de su rama la escribe ella | `commitsAutomaticos`, `RepoStore.integrar`, `instantanea` | `ide.test.ts`, `repos.test.ts` ([[ADR-010 Los agentes no commitean y la persona publica]]) |
| 6.4 | **Integrar una rama propia nunca la pisa**: fast-forward o `rama:rama` sin `+` | con `+rama:rama` una sesión en `main` le reescribía su `main` | `integrarRamaPropia` | `scm.test.ts` → "integrar una rama con nombre propio nunca pisa la de la persona" |
| 6.5 | **Git endurecido**: sin hooks ni fsmonitor, sin config global ni de sistema, nunca pregunta, `--git-dir` explícito, `cwd` = worktree, `GIT_OPTIONAL_LOCKS=0` con reintento ante `index.lock` | los agentes escriben donde git corre | `git.ts` → `CONFIG_SEGURA`, `entornoGit`, `git` | `git.test.ts`; `repos.test.ts` → `validarUrlGit` |
| 6.6 | **Uno escribe por vez**: arriendo por repo (vence a los 45 min); el que no lo tiene va en sólo lectura y el prompt lo dice | dos agentes editando el mismo árbol | `ArriendosDeCodigo`, `abrirTurnoDeCodigo` | `codigo.test.ts` → "sin el arriendo de escritura no toca nada" |
| 6.7 | **La allowlist decide, el sandbox contiene**; `exit ≠ 0` es `ok: true`; entorno sin credenciales y `CI=1`; el corte mata el grupo | permitir `npm test` es permitir código del agente | `argv.ts`, `ejecutar.ts` | `argv.test.ts`, `codigo.test.ts` ([[ADR-011 La allowlist decide y el sandbox contiene]]) |
| 6.8 | **`editar_codigo` exige match exacto y único**; igual salvo indentación se informa y no se aplica | en Python o YAML la indentación es código | `codigo/index.ts` | `codigo.test.ts` → "editar_codigo" |
| 6.9 | **Una dependencia se pide y aprobar instala**: sólo paquetes del registro por nombre, siempre `--ignore-scripts`, validado en la herramienta y otra vez al aprobar | un `postinstall` es código arbitrario | `dependencias.ts`, `Runtime.instalarDependencias` | `dependencias.test.ts`; `ide.test.ts` → "aprobar una dependencia" |
| 6.10 | **El CLI de Claude no tiene `Bash`** y sobre la salida sólo lee | un `Write` o un `Bash` del CLI saltean saneo, procedencia y sandbox | `claude-code.ts` → `construirArgs`, `NEGADAS_EN_CODIGO` | `claude-code.test.ts` ([[ADR-018 Los CLI de suscripción reciben el puente MCP del org]]) |
| 6.11 | **Guardar desde el IDE lleva el hash de lo cargado**; con un agente escribiendo, el editor es de sólo lectura (409) | pisar el trabajo de un agente sin que nadie se entere | `RepoStore.escribirArchivo`, rutas de `rutas-codigo.ts` | `repos.test.ts` → "guardar con el hash de lo que se cargó…" |
| 6.12 | **La terminal no es una shell**: misma allowlist y mismo sandbox | la API escucha en localhost con una página cualquiera al lado | `rutas-codigo.ts` | sin test propio |
| 6.13 | **La vista previa corre con CSP `sandbox allow-scripts`** y la API sólo le contesta a los orígenes de la app | un `.html` de un agente no puede correr con la sesión de la app | `construirApp({ origenes })`, rutas `/api/repos/:id/vista/*` | `ide.test.ts` → "vista previa", "CORS" |
| 6.14 | **Los servicios de la vista previa le hablan a la vista previa**: puertos propios (4300-4399, internos 4400-4499), URLs locales reescritas, `.env` inyectados sin copiar y con secretos tapados | se ve bien y muestra otra cosa | `servicios.ts` → `ServiciosVivos`, `redirigirUrlsLocales` | `servicios.test.ts` (servidor y shared) |
| 6.15 | **Una corrida enfocada tiene un solo rol** y no adopta tareas ajenas | "mejorá esta función" terminaba en una reunión de cuatro agentes | `createRunSchema.foco`, `Runtime.startRun` | `ide.test.ts` → "una corrida enfocada tiene un solo agente…" |

## 7. Móvil

| # | Regla | Por qué | Dónde se hace cumplir | Qué lo fija |
|---|---|---|---|---|
| 7.1 | **Nunca un `adb shell` libre**: las herramientas miran sólo la app del repo | el teléfono es de una persona | `depuracion-movil.ts`, `codigo/telefono.ts` | `depuracion-movil.test.ts` |
| 7.2 | **QA por texto, nunca por coordenadas**; la app tiene que seguir al frente antes de cada toque; nunca la franja del sistema (`ZONA_UTIL`); pasos, esperas y texto con tope | un toque a ciegas cae en otro botón o fuera de la app | `qa-movil.ts`, `pasos-app.ts` | `qa-movil.test.ts`, `pasos-app.test.ts`, `qa-movil-storage.test.ts` |
| 7.3 | **Producción se niega**: `manejar_app` y R2 no actúan si el entorno apunta a producción; el motivo nombra variables, nunca valores | cada toque puede crear datos reales | `detectarProduccion`, `marcadoresProduccion` | `qa-movil.test.ts`, `qa-movil-storage.test.ts`, `r2.test.ts` |
| 7.4 | **El WebSocket del espejo verifica el `Origin`** | un WebSocket no pasa por CORS | `ws.ts` | `ws.test.ts` |
| 7.5 | **Un AAB/APK se verifica antes de entregarse** y el build más reciente no se borra | es la referencia de `versionCode` y certificado del próximo | `aab.ts` → `ConstructorDeAab` | `aab.test.ts` |

## 8. Interfaz

| # | Regla | Por qué | Dónde se hace cumplir | Qué lo fija |
|---|---|---|---|---|
| 8.1 | **La UI no hace polling de la traza**: deriva su estado de los eventos | "en vivo" y "retroceder" son la misma operación | `lib/stream.ts`, `lib/derive.ts` | sin test propio |
| 8.2 | **La navegación vive en la URL** (`/p/:companyId/...`) | "qué proyecto está abierto" no es estado de React | `App.tsx` | — |
| 8.3 | **`content-type` sólo con cuerpo** | Fastify contesta 400 a un DELETE con JSON vacío | `api.ts` → `request` | — |
| 8.4 | **Los nodos del organigrama se reusan**, no se rearman | React Flow los deja invisibles hasta medirlos | `OrgGraph` → `useNodesState` | — |
| 8.5 | **`min-w-0` en grillas y columnas explícitas** (`minmax(0,1fr)`) | `min-width:auto` desborda la página | `lib/ui.tsx` → `Panel`; `Codigo.tsx` | — |

## Checklist antes de un cambio grande

- [ ] ¿El campo nuevo entró primero en `schema.ts`?
- [ ] ¿El motor sigue sin importar Fastify ni SQLite?
- [ ] ¿Introduje estado mutable por turno en `RunState`?
- [ ] ¿El paso nuevo emite un evento, y su cierre va en `finally`?
- [ ] ¿La llamada de red nueva tiene corte por tiempo?
- [ ] ¿La herramienta nueva tiene su freno en el ejecutor, no en la descripción?
- [ ] ¿Una ruta que viene de un modelo pasa por el saneo?
- [ ] ¿Un secreto nuevo se guarda por referencia?
- [ ] ¿Toqué uno de los números acoplados (3.7)?
- [ ] ¿`npm run typecheck && npm test` pasan?

## Ver también

- [[Trampas conocidas]] · [[Decisiones de arquitectura]] · [[Guía de contribución]]
- [[Arquitectura general]] · [[Pruebas y calidad]] · [[Seguridad]]
