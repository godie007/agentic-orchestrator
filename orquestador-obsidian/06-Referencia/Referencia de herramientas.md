---
tags: [referencia, plataforma]
aliases: [Herramientas detalle, Tools referencia, lista de herramientas, argumentos de herramientas]
---

# Referencia de herramientas

**Todas** las herramientas que el código registra, familia por familia, con sus
argumentos. La visión general está en [[Catálogo de herramientas]]; el mecanismo
(contrato, registro, router, ejecución) en [[Herramientas y tool router]].

Hay 75 herramientas estáticas más dos familias dinámicas (`mcp` y `creada`).

## Cómo leer las tablas

- **RO** = `readOnly` (corre en paralelo y se memoiza en el turno). **Apr.** =
  `requiresApproval` (no corre: abre una aprobación y, al concederse, se ejecuta
  con esos argumentos).
- Argumentos: `nombre*` es requerido; `a|b` es un enum; `[]` una lista. Todos los
  esquemas cierran con `additionalProperties: false`, así que un argumento que no
  figura acá se ignora y no cambia la huella del memo.
- **Recibe**: "siempre" = la otorga `forRole` sin mirar `toolIds`; "por `toolIds`"
  = hay que asignarla al rol (y tener fila en `tools`).
- Los errores vuelven como `ERROR: …` al modelo y no cortan el turno.

## Coordinación — hablar y organizarse

Origen `coordination` · registro **siempre** · recibe **siempre** · archivo
`packages/tools/src/coordination.ts` (salvo indicación) · nota
[[Coordinación entre agentes]].

| Herramienta | RO | Apr. | Argumentos | Qué hace |
|---|---|---|---|---|
| `send_message` | — | — | `to*`, `type*`: `request\|report`, `subject*`, `body*` | mensaje a otro rol, por nombre, cargo o id. **Rechaza escribirle de nuevo a quien no contestó** y escribirse a sí mismo |
| `reply` | — | — | `body*` | contesta el mensaje del turno en su hilo (`type: response`). Si lo escribió la persona, explica que no hace falta y remite a `request_context` |
| `broadcast` | — | — | `department*`, `subject*`, `body*` | anuncio a todo un departamento |
| `escalate` | — | — | `reason*`, `detail*` | mensaje `escalation` a `reportsTo`; quien no reporta a nadie recibe "la decisión es tuya" |
| `assign_task` | — | — | `assignee*`, `title*`, `detail*`, `priority`: `low\|normal\|high\|urgent` | crea una tarea. Sólo a reportes directos (salvo `executive`); el rechazo lista el equipo real. Rechaza duplicar una abierta con el mismo título normalizado |
| `update_task` | — | — | `task_id*`, `status*`: `in_progress\|in_review\|blocked\|done\|cancelled`, `result` | mueve **sólo las propias**. No cambia prioridad |
| `list_my_tasks` | ✓ | — | — | las tareas propias con estado y prioridad |
| `request_approval` | — | — | `reason*` | pide autorización a `reportsTo` (o a la persona); la rama se detiene |

Ver también [[Supervisión y continuidad]] y [[Aprobaciones y solicitudes]].

## Coordinación — entregables, cálculo y auditoría

Mismo origen y reglas. Notas [[Entregables]] y [[Auditoría de corridas]].

| Herramienta | RO | Apr. | Argumentos | Qué hace |
|---|---|---|---|---|
| `write_artifact` | — | — | `key*`, `title*`, `content*`, `content_type`: `markdown\|json\|text` | crea o versiona. `revisarCalidad` rechaza títulos de proceso ("Ciclo 2"), dictámenes ("Correcciones…") y muros de más de 400 caracteres sin estructura; avisa párrafos de más de 900. Rechaza claves-variante (`-ciclo3`, `_v2`, `-final`, `-detalle`) |
| `edit_artifact` | — | — | `key*`, `cambios*`: `[{ buscar*, reemplazar }]` | reemplazos exactos y únicos, en orden, todo o nada; tolera saltos de línea aplanados. Nueva versión con la misma guardia de calidad. No emite `artifact.created` |
| `read_artifact` | ✓ | — | `key*`, `seccion` (varias separadas por coma) | entero hasta 15.000 caracteres; más largo y con varios encabezados, devuelve el índice. Las secciones van literales |
| `list_artifacts` | ✓ | — | — | los de la empresa, marcando los de otra corrida |
| `buscar_en_entregables` | ✓ | — | `pregunta*`, `clave` | hasta 5 fragmentos puntuados (900 caracteres c/u) con su fuente. Archivo `busqueda.ts` |
| `calcular` | ✓ | — | `expresion*`, `esperado`, `concepto` | evaluador propio (sin `eval`) de `+ - * / ( ) ^ %`, números como se escriben (`$ 3.200.000`, `0,65`); con `esperado` compara con tolerancia 0,5 %. Huella: `expresion`+`esperado`. Archivo `calculo.ts` |
| `verificar_cifras` | ✓ | — | `entregable`, `cifras*`: `[{ concepto*, expresion*, esperado*, fuente }]` | tabla de veredictos de una vez y registro contra la **versión** del entregable: sin eso `export_*` no deja salir un documento con plata o porcentajes. Huella sólo `cifras`. Archivo `calculo.ts` |
| `check_activity` | ✓ | — | `role`, `only_failures` | lo que cada agente **ejecutó** y con qué resultado (últimas 60 de hasta 500) |
| `estado_del_proceso` | ✓ | — | `solo_pendiente` | tablero de todos, entregables, quién no ejecutó nada, últimos 8 fallos |
| `record_lesson` | — | — | `topic*`, `lesson*`, `evidence*` | memoria de la empresa. Rechaza a quien en la corrida sólo habló (`HABLAR_NO_ES_EVIDENCIA`); evidencia hasta 600 caracteres. Nota [[Memoria de la empresa]] |

## Coordinación — pedidos a la persona y crecimiento

| Herramienta | RO | Apr. | Argumentos | Qué hace |
|---|---|---|---|---|
| `request_new_role` | — | — | `name*`, `title*`, `department*`, `system_prompt*`, `reports_to`, `reason*` | solicitud `create_role`; el propuesto nace `executor` |
| `request_context` | — | — | `question*`, `reason*` | solicitud `context`; una pendiente por vez |
| `request_tool_access` | — | — | `tools*`: `[string]`, `reason*` | solicitud `tool_access` |
| `solicitar_servidor_mcp` | — | — | `config*` (JSON `{"mcpServers":…}` o mapa), `reason*` | sanea con `parsearConfigMcp` (descarta secretos y lo avisa); si el servidor ya existe remite a `request_tool_access`. Al aprobar se instala y se le otorga. Nota [[Integración MCP]] |
| `convocar_especialista` | — | — | `name*`, `title*`, `department*`, `system_prompt*`, `tools`: `[string]`, `reason*` | incorpora un rol **ya**. Sólo `executive`, tope 4 por corrida, nace `executor`, sólo herramientas del catálogo (las inexistentes se nombran). Nota [[Especialistas convocados]] |
| `crear_herramienta` | — | — | `name*`, `description*`, `pasos*`: `[{ tool*, args }]` (1-6) | compuesta declarativa con huecos `{{param}}`. `executive`/`manager`; sólo compone lo que el creador puede ejecutar, sin compuestas ni pasos con aprobación. Registro por empresa. Archivo `compuestas.ts`. Nota [[Herramientas compuestas]] |

## Coordinación — árbol de contexto

Registradas por empresa en `companyRuntime` · archivo `packages/tools/src/contexto.ts` · nota [[Vault de contexto]].

| Herramienta | RO | Apr. | Argumentos | Qué hace |
|---|---|---|---|---|
| `leer_contexto` | ✓ | — | `ruta*` | abre una nota del vault de la empresa (el mapa ya viaja en el prompt) |
| `buscar_contexto` | ✓ | — | `texto*` | dónde aparece (ruta → línea), no el contenido |
| `escribir_contexto` | — | — | `ruta*`, `contenido*` | reemplaza la nota entera; menos de 40 caracteres se rechaza (eso es `record_lesson`) |

## Capacidades — hacia afuera

Origen `capability` · recibe **por `toolIds`** · compiten en el ranking del router.

| Herramienta | RO | Apr. | Argumentos | Registro | Qué hace |
|---|---|---|---|---|---|
| `web_search` | ✓ | — | `query*` | siempre (`capability.ts`) | con `openrouter` se reemplaza por la búsqueda nativa del proveedor; con otro, falla explicando y sugiere `fetch_url` |
| `fetch_url` | ✓ | — | `url*` | siempre (`capability.ts`) | http/https, corte 20 s, sólo contenido de texto (`text/`, `json`, `xml`), HTML a texto, recorte a 40.000 caracteres. Bloquea `localhost`, `*.localhost`, `*.internal`, `::1`, `127/8`, `10/8`, `0/8`, `172.16/12`, `192.168/16`, `169.254/16` |
| `send_email` | — | — | `para*`: `[string]`, `asunto*`, `cuerpo*`, `adjuntos`: `[ruta de salida]` | siempre, por empresa (`correo.ts`) | correo por el webhook de n8n; adjuntos como enlace. Nota [[Correo y avisos]] |

> [!warning] Límites de `fetch_url`
> El bloqueo mira el **hostname escrito** en la URL: no resuelve DNS, no revisa
> los saltos de una redirección (`redirect: "follow"`) ni cubre rangos IPv6
> privados distintos de `::1`.

## Habilidades — documentos, video y salida

Origen `skill` · recibe **por `toolIds`** · fijas en el router · archivo
`packages/tools/src/skills/index.ts` → `createSkillTools`. Las `export_*` reciben
la **clave** de un entregable (`artifact_key`), nunca el contenido
([[ADR-005 Las habilidades trabajan sobre entregables ya escritos]]), y se niegan
si el entregable tiene cifras sin verificar en su versión actual.

| Herramienta | RO | Apr. | Argumentos | Registro | Qué hace |
|---|---|---|---|---|---|
| `export_docx` | — | — | `artifact_key*`, `folder` | siempre | Word con portada, encabezado, pie, tablas. Un archivo por entregable (`key.docx`), borra los `key-vN` viejos. Nota [[Documentos Word y PDF]] |
| `export_pdf` | — | — | `artifact_key*`, `folder` | siempre | lo mismo en PDF |
| `export_video` | — | — | `artifact_key*`, `folder`, `musica` (`"ninguna"` = silencio) | siempre | guion → MP4 narrado con ffmpeg. Nota [[Motor de video ASS]] |
| `export_slides` | — | — | `artifact_key*`, `folder` | siempre | el mismo guion como deck `.html` autocontenido. Nota [[Deck de slides]] |
| `estimar_duracion` | ✓ | — | `artifact_key*` | siempre | duración con el mismo reloj del render, por escena. Nota [[Guion como línea de tiempo]] |
| `export_video_estudio` | — | — | `artifact_key*`, `folder`, `musica` | **sólo con Chrome** | cada escena como lámina HTML de `escenas/NN-*.html`. Nota [[Motor estudio de láminas HTML]] |
| `revisar_lamina` | — | — | `path*` | sólo con Chrome | revela una lámina a PNG y dice qué salió mal; deja el kit y su guía |
| `explorar_pantalla` | ✓ | — | `pasos*`: acciones, `buscar`: `[string]`, `sesion` | sólo con Chrome | reconoce una pantalla sin filmar; dice qué textos son **estables** |
| `grabar_clip` | — | — | `archivo*`, `preparacion`: acciones, `acciones*`: acciones, `colchon_segundos` (2,5), `sesion` | sólo con Chrome | clip MP4 real en `clips/`; la preparación va fuera de cámara. Nota [[Motor de clips grabados]] |
| `export_video_clips` | — | — | `artifact_key*`, `folder`, `musica` | sólo con Chrome | empalma los clips con la narración |
| `generar_imagen` | — | — | `descripcion*`, `folder` (`imagenes`), `orientacion`: `apaisada\|vertical` | **sólo con `GOOGLE_API_KEY`/`GEMINI_API_KEY`, `OPENAI_API_KEY` o `NVIDIA_API_KEY`** | imagen sin texto adentro. Nota [[Imágenes y medios]] |
| `inspeccionar_medio` | ✓ | — | `path*` | siempre | duración, resolución, códecs, pista de audio, peso (ffprobe) |
| `extraer_cuadros` | — | — | `path*`, `cantidad` (6, máx. 12) | siempre | PNG repartidos a `revision/`, con el segundo en el nombre |
| `list_output` | ✓ | — | — | siempre | el directorio de salida con procedencia y si se puede borrar |
| `read_output_file` | ✓ | — | `path*` | siempre | texto de un archivo de la salida, hasta 24.000 caracteres |
| `write_output_file` | — | — | `path*`, `content*` | siempre | crea o reemplaza; saca la versión del nombre y avisa si parece código fuente |
| `delete_files` | — | — | `path` o `kind`: `multimedia\|documents\|all`, `folder` | siempre | borrado sujeto a `puedeBorrar` (executive todo, manager apoyo, executor nada) y a procedencia. Sin papelera |

**Acciones** de `explorar_pantalla` y `grabar_clip` (una clave por objeto): `ir`
(URL o `salida://ruta`), `esperar_texto`, `clic` (texto), `clic_selector`,
`escribir { selector*, texto* }`, `subir_archivo { archivo*, selector }`,
`tecla` (`Enter`/`Tab`), `esperar` (ms). Nota de salida:
[[Archivos de salida y permisos de borrado]]; navegador:
[[Navegador Chrome por CDP]].

## Código

Origen `skill` · registro **siempre, aunque no haya repo** (sin repo cada una dice
qué falta y quién lo carga) · recibe por `toolIds` · archivo
`packages/tools/src/codigo/index.ts` → `crearHerramientasDeCodigo` · `repo`
(nombre o id) es opcional en todas si el proyecto tiene uno solo · nota
[[Herramientas de código]]. Las que escriben necesitan el **arriendo** del repo
([[Arriendo de escritura y resumen de código]]).

| Herramienta | RO | Apr. | Argumentos | Qué hace |
|---|---|---|---|---|
| `listar_repositorios` | ✓ | — | — | repos, sesión, tests, comandos permitidos, si hay arriendo, servicios |
| `mapa_del_codigo` | ✓ | — | `carpeta` | carpetas y símbolos por archivo, rankeados por uso |
| `buscar_codigo` | ✓ | — | `patron*` (regex extendida), `archivos` (glob), `ignorarMayusculas`, `contexto` (0-5) | `git grep --untracked`, hasta 12.000 caracteres |
| `buscar_archivos` | ✓ | — | `patron*` (glob) | archivos que coinciden, hasta 300 |
| `leer_codigo` | ✓ | — | `ruta*`, `desde`, `limite` (≤ 700) | 350 líneas numeradas por defecto, ≤ 15.000 caracteres |
| `estado_git` | ✓ | — | `ruta`, `conDiff` | cambios contra la base y checkpoints (marca los nuevos con `--intent-to-add`) |
| `editar_codigo` | — | — | `ruta*`, `buscar*`, `reemplazar*`, `todas` | reemplazo exacto y único; igual salvo indentación se informa y no se aplica. Archivos ≤ 1 MB |
| `escribir_codigo` | — | — | `ruta*`, `contenido*` | crea o reemplaza un archivo entero (≤ 1 MB) |
| `aplicar_parche` | — | — | `parche*` (diff unificado) | `git apply --check` antes: entra todo o nada; nunca toca `.git` |
| `revertir_codigo` | — | — | `ruta` o `checkpoint` | vuelve un archivo al último checkpoint o revierte un commit de la sesión |
| `ejecutar_comando` | — | — | `comando*`, `segundos` (5-600, 120), `repetir`, `carpeta` | argv sin shell, allowlist y sandbox. `exit ≠ 0` es `ok`. Reusa el resultado si el árbol no cambió. Nota [[Comandos y sandbox]] |
| `solicitar_comando` | — | — | `comando*`, `motivo*` | solicitud `comando` (sin `request.created`) |
| `crear_repositorio` | — | — | `nombre*`, `descripcion` | repo nuevo; `executor` no puede |
| `instalar_dependencia` | — | — | `paquetes*`: `[string]` (≤ 10), `dev`, `motivo*`, `carpeta` | solicitud `dependencia`; aprobarla instala sin scripts. Nota [[Instalación de dependencias]] |
| `servicios` | ✓ | — | `accion`: `listar\|logs`, `servicio`, `lineas` (10-400, 80) | estado y logs de los servicios. Nota [[Servicios del monorepo]] |
| `probar_servicio` | — | — | `servicio*`, `ruta*` (empieza con `/`), `metodo`: `GET…OPTIONS`, `cuerpo`, `cabeceras` | pedido HTTP sólo a un servicio del repo |

## Teléfono

Origen `skill` · registro **sólo si hay adb** · recibe por `toolIds` · archivo
`packages/tools/src/codigo/telefono.ts` · miran sólo la app del repo · nota
[[Depuración de la app móvil]] y [[QA móvil]].

| Herramienta | RO | Apr. | Argumentos | Qué hace |
|---|---|---|---|---|
| `logs_del_telefono` | ✓ | — | `alcance`: `app\|fallas`, `nivel`: `V\|D\|I\|W\|E` (I), `lineas` (10-1500, 200), `buscar` | logcat de la app, con crashes desde su comienzo |
| `estado_de_la_app` | ✓ | — | — | versión, si corre, memoria, túneles |
| `archivos_de_la_app` | ✓ | — | `accion*`: `listar\|leer`, `ruta` | sandbox de la app por `run-as` (build de desarrollo) |
| `consultar_base_de_la_app` | ✓ | — | `archivo*`, `sql*` | SQLite copiada con su WAL, sólo lectura |
| `captura_del_telefono` | — | — | — | PNG a `revision/` sólo con la app al frente |
| `adb_diagnostico` | ✓ | — | `comando*` | allowlist (`dumpsys meminfo`, `gfxinfo`, `getprop`…) |
| `reiniciar_app` | — | — | — | cierra y abre con túneles |
| `limpiar_datos_de_la_app` | — | **✓** | `motivo*` | `pm clear`: se lleva la cola offline |
| `explorar_telefono` | ✓ | — | `buscar`: `[string]` (≤ 10) | la pantalla en texto con testIDs |
| `manejar_app` | — | — | `pasos*` (≤ 20): `tocar_texto`, `esperar_texto`, `escribir`, `tecla`, `deslizar`, `esperar` | maneja la app nombrando lo que toca, nunca por coordenadas |

## R2

Origen `skill` · registro **siempre** (sin credenciales dice cuáles faltan) ·
archivo `packages/tools/src/codigo/r2.ts` · nota [[Almacenamiento R2]].

| Herramienta | RO | Apr. | Argumentos | Qué hace |
|---|---|---|---|---|
| `r2_listar` | ✓ | — | `prefijo`, `carpetas`, `limite` (1-200, 50), `desde` | objetos del bucket de staging |
| `r2_objetos` | — | — | `claves*`: `[string]` (≤ 20), `guardar` (≤ 5, 25 MB c/u) | verifica objetos y su tipo real; puede bajarlos a `revision/r2/` |

## Familias dinámicas

| Familia | Nombre | Origen | RO / Apr. | Recibe | Nota |
|---|---|---|---|---|---|
| servidores MCP | `mcp__<servidor>__<tool>` | `mcp` | `readOnly` = `readOnlyHint`; aprobación si `autoApproveTools` está apagado y no es de lectura | por `toolIds` | [[Integración MCP]] |
| compuestas | el que elija el agente | `creada` | nunca RO; sin aprobación | el creador, y por `toolIds` | [[Herramientas compuestas]] |

En la traza aparecen además dos nombres que **no** son herramientas registradas:
`mcp__orq__<nombre>` (cómo ve un CLI delegado las del org) y `cli:<Nombre>` (lo
que el CLI usó por su cuenta, con `origin: "capability"`). Ver
[[Turnos delegados a un CLI]].

## Quién recibe qué por defecto

- **Todo rol**: las 27 de coordinación.
- **Mejorador de código** (chat del IDE): todas las de `HERRAMIENTAS_DE_CODIGO`
  (código, teléfono y R2), puesto al día antes de cada pedido.
- **QA móvil**: la lista `QA_MOVIL.herramientas` (`packages/shared/src/plantillas.ts`),
  sin las que escriben código.
- **Plantillas de equipo**: cada rol nombra las suyas; ver
  [[Referencia de plantillas de equipo]].

## Fuentes

- `packages/tools/src/coordination.ts` → `coordinationTools`
- `packages/tools/src/calculo.ts`, `busqueda.ts`, `contexto.ts`, `compuestas.ts`, `capability.ts`, `correo.ts`
- `packages/tools/src/skills/index.ts` → `createSkillTools`
- `packages/tools/src/codigo/index.ts`, `codigo/telefono.ts`, `codigo/r2.ts`, `codigo/pasos-app.ts`
- `apps/server/src/runtime.ts` → `companyRuntime`, `registrarCodigoEn`

## Ver también

- [[Catálogo de herramientas]] · [[Herramientas y tool router]]
- [[Cómo agregar una herramienta]]
