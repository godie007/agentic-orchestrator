---
tags: [capacidad, plataforma]
aliases: [Herramientas, Tools, familias de herramientas]
---

# Catálogo de herramientas

El mapa de todo lo que un agente puede invocar: qué familias hay, cuándo existen
en una empresa y quién las recibe. Los argumentos de cada una están en
[[Referencia de herramientas]]; el mecanismo, en [[Herramientas y tool router]].

## Por qué hay familias

Una herramienta no es sólo "algo que el agente puede hacer": su **origen** decide
si se asigna, si compite por un lugar en el turno y si se puede probar sin una
corrida. Se agrupan por lo que significan para el rol: cómo habla con la empresa
(coordinación), qué hace hacia afuera (capacidades), qué sabe producir
(habilidades), de dónde lee (MCP) y qué se armó a sí mismo (compuestas).

## Las familias

| Familia | Origen | Cant. | Existe en la empresa… | Recibe | Nota |
|---|---|---|---|---|---|
| Coordinación | `coordination` | 23 | siempre | **todo rol, siempre** | [[Coordinación entre agentes]] |
| Árbol de contexto | `coordination` | 3 | siempre | todo rol | [[Vault de contexto]] |
| `crear_herramienta` | `coordination` | 1 | siempre | todo rol (la usan `executive`/`manager`) | [[Herramientas compuestas]] |
| Capacidades | `capability` | 3 | siempre | por `toolIds` | esta nota · [[Correo y avisos]] |
| Documentos, video y salida | `skill` | 11 | siempre | por `toolIds` | [[Habilidades de producción]] |
| Motores con navegador | `skill` | 5 | **sólo con Chrome** | por `toolIds` | [[Producción audiovisual]] |
| `generar_imagen` | `skill` | 1 | **sólo con key de imágenes** | por `toolIds` | [[Imágenes y medios]] |
| Código | `skill` | 16 | siempre (aunque no haya repo) | por `toolIds` | [[Trabajo con código]] |
| Teléfono | `skill` | 10 | **sólo con adb** | por `toolIds` | [[App móvil en el teléfono]] |
| R2 | `skill` | 2 | siempre | por `toolIds` | [[Almacenamiento R2]] |
| MCP | `mcp` | variable | al conectar cada servidor | por `toolIds` | [[Integración MCP]] |
| Compuestas | `creada` | variable | cuando un agente las crea | el creador y por `toolIds` | [[Herramientas compuestas]] |

Son 75 estáticas en una máquina con Chrome, adb y key de imágenes.

## Las reglas que las ordenan

**Coordinación siempre.** Sin ellas un agente no puede responder, delegar ni
escalar. `calcular` y `verificar_cifras` están en esta familia sin coordinar a
nadie: hacer una cuenta bien es higiene, no una capacidad especial que haya que
asignar rol por rol.

**Una habilidad nunca se otorga sola.** Depende de `role.toolIds`, que apunta a
filas de la tabla `tools`. Por eso una empresa creada por la API siembra
`capability` y `skill` (`Runtime.sembrarHerramientas`) y el seed también; si
armás una empresa por código sin sembrar, vas a ver a un agente explicando que no
encuentra `export_video`.

**La que no se puede cumplir no se registra.** Ofrecer una herramienta que
siempre falla le hace gastar turnos intentándola: sin Chrome no hay motores de
estudio ni clips, sin adb no hay teléfono, sin key no hay `generar_imagen`. Tres
excepciones conscientes se registran igual y **explican qué falta**: las de
código (una plantilla las otorga antes de que alguien cargue el repo), las de R2
(dicen qué credencial falta) y `send_email` (dice que falta el webhook).

**Las fijas no compiten.** En el turno, coordinación, habilidades y compuestas se
exponen siempre; sólo `capability` y `mcp` se rankean por relevancia (12
lugares). Ver [[Herramientas y tool router]].

## Coordinación

Mensajes (`send_message`, `reply`, `broadcast`, `escalate`), trabajo
(`assign_task`, `update_task`, `list_my_tasks`, `request_approval`), entregables
(`write_artifact`, `edit_artifact`, `read_artifact`, `list_artifacts`,
`buscar_en_entregables`), cálculo (`calcular`, `verificar_cifras`), supervisión
(`check_activity`, `estado_del_proceso`), memoria (`record_lesson`), pedidos a la
persona (`request_new_role`, `request_context`, `request_tool_access`,
`solicitar_servidor_mcp`), crecer en el acto (`convocar_especialista`,
`crear_herramienta`) y contexto largo (`leer_contexto`, `buscar_contexto`,
`escribir_contexto`).

Casi todas validan en el ejecutor lo que un prompt no garantiza: la jerarquía de
`assign_task`, "uno por persona hasta que conteste" de `send_message`, la
evidencia de `record_lesson`, el tope de convocatoria, las claves-variante de
`write_artifact`.

## Capacidades

| Herramienta | Para qué |
|---|---|
| `web_search` | búsqueda web. Sólo funciona con búsqueda nativa del proveedor (`openrouter`); en los demás, el motor la deja expuesta y falla explicando |
| `fetch_url` | leer una URL pública concreta. Bloquea la red interna por hostname |
| `send_email` | avisar a alguien de afuera por el webhook de n8n |

Una búsqueda que funcione con cualquier proveedor sale de un servidor MCP
(Brave, DuckDuckGo, Tavily, Exa: ver [[Referencia de la tienda MCP]]).

## Habilidades

Producir documentos (`export_docx`, `export_pdf`), video (`export_video`,
`export_video_estudio`, `export_video_clips`, `grabar_clip`, `revisar_lamina`,
`explorar_pantalla`, `estimar_duracion`), deck (`export_slides`), imágenes
(`generar_imagen`), verificar lo producido (`inspeccionar_medio`,
`extraer_cuadros`) y manejar la salida (`list_output`, `read_output_file`,
`write_output_file`, `delete_files`). Reciben la clave de un entregable ya escrito,
nunca el contenido ([[ADR-005 Las habilidades trabajan sobre entregables ya escritos]]).

## Código, teléfono y R2

Programar sobre un clon gestionado (`listar_repositorios` … `probar_servicio`),
depurar la app móvil en el teléfono vinculado (`logs_del_telefono` …
`manejar_app`) y verificar el bucket (`r2_listar`, `r2_objetos`). Son `skill`
para que se siembren y se asignen por rol. Ver [[Herramientas de código]] y
[[Depuración de la app móvil]].

## Dónde se ven y se asignan

- **Empresa → rol → "Herramientas asignadas"**: agrupadas en Habilidades,
  Capacidades, Creadas por agentes y un grupo por servidor MCP; coordinación como
  etiquetas no quitables. Marca "pide aprobación" y "escribe".
- **Hub MCP**: la matriz "Quién usa qué" da o quita todas las de un servidor.
- Asignar desde la configuración llega a la corrida viva
  (`Runtime.actualizarRolEnCorridasVivas`).

## Fuentes

- `packages/tools/src/registry.ts` · `packages/tools/src/router.ts`
- `packages/tools/src/coordination.ts`, `capability.ts`, `correo.ts`, `skills/index.ts`, `codigo/*`
- `apps/server/src/runtime.ts` → `companyRuntime`, `registrarCodigoEn`, `sembrarHerramientas`
- `apps/web/src/routes/Settings.tsx` → `AsignacionDeHerramientas`

## Ver también

- [[Referencia de herramientas]] · [[Herramientas y tool router]]
- [[Cómo agregar una herramienta]] · [[Pantalla Empresa y organigrama]]
