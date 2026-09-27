---
tags: [meta, referencia]
aliases: [Términos, Vocabulario]
---

# Glosario

Los términos del sistema, tal como los usa el código. Cada uno enlaza a la nota
que lo explica.

## Empresa y organización

| Término | Definición | Nota |
|---|---|---|
| **Empresa** (`Company`) | La unidad de configuración: misión, contexto, moneda, presupuesto por corrida, modelo por defecto, voz y marca. En la UI se la llama "proyecto": es un rótulo de pantalla, no otra entidad. | [[Modelo de dominio]] |
| **Departamento** | Agrupador de roles con un propósito. | [[Organización de agentes]] |
| **Rol** | **Un agente**: prompt, modelo, bandeja, herramientas, autoridad y a quién reporta. | [[Organización de agentes]] |
| **Autoridad** | `executive` / `manager` / `executor`. La hace cumplir el ejecutor de cada herramienta: quién convoca, quién crea herramientas, quién borra qué. | [[Organización de agentes]] |
| **Política** | Regla de negocio que llega al prompt como texto. Su `gate` está en el esquema pero hoy ningún código lo evalúa. | [[Modelo de dominio]] |
| **Plantilla de equipo** | Organigrama probado (`PLANTILLAS_EQUIPO`) que se materializa al crear un proyecto; las herramientas faltantes se nombran, no se callan. | [[Plantillas de equipo]] |
| **Proveedor preferido** | El primero configurado en la prioridad `claude-sesion` → `anthropic` → `claude-code` → `opencode` → `openrouter`; con él nacen los agentes nuevos. | [[Plantillas de equipo]] |
| **Especialista convocado** | Rol `executor` que un `executive` suma en plena corrida con `convocar_especialista`; hasta 4 por corrida. | [[Especialistas convocados]] |
| **Blueprint** | La empresa entera como JSON, sin credenciales ni rutas locales, para exportar e importar. | [[Esquemas de empresa y organización]] |

## Corridas y motor

| Término | Definición | Nota |
|---|---|---|
| **Corrida** (`Run`) | Una ejecución de la empresa contra un encargo, con tope de ciclos y de presupuesto. Vive en memoria: no sobrevive a un reinicio. | [[Scheduler y ciclo de una corrida]] |
| **Ciclo** (tick) | Vuelta de la empresa en la que cada rol con trabajo corre **a lo sumo una vez**; lo que uno entrega lo toma **en el mismo ciclo** quien todavía no corrió (una cadena, no una ronda). | [[Scheduler y ciclo de una corrida]] |
| **Turno** | Lo que hace un rol dentro de un ciclo: iteraciones del agent loop con base y techo según su carga. | [[Motor de agentes]] |
| **Presupuesto de iteraciones** | Base y techo de vueltas por turno; `maxTurns` es el piso y el techo máximo es 50. | [[Motor de agentes]] |
| **Orden por urgencia** | Dentro del ciclo corre primero quien tiene pedidos sin contestar y al final quien viene fallando. | [[Scheduler y ciclo de una corrida]] |
| **Pedido perdido** | Corrida que termina sin entregables, mensajes, código ni consulta respondida: cierra `failed`. | [[Scheduler y ciclo de una corrida]] |
| **Corrida enfocada** (`run.foco`) | Pedido del chat del IDE: un solo rol, un repo, 4 ciclos; termina cuando el agente responde. | [[Chat de IA]] |
| **`forActor`** | Vista del estado con el actor atado en el closure, nunca en un campo mutable (turnos en paralelo se pisaban). | [[Estado de una corrida]] |
| **Actividad** (`activity`) | Registro de cada llamada a herramienta con su resultado real, grabado por el loop y no por el agente. | [[Estado de una corrida]] |
| **Turno interrumpido** | Conversación guardada de un turno que falló, que se continúa en vez de reempezar. | [[Estado de una corrida]] |
| **Memo de lecturas** | Una lectura idéntica dentro del mismo turno devuelve un puntero en vez del contenido. | [[Motor de agentes]] |
| **Compactación** | Retiro de resultados ya consumidos cuando la conversación del turno crece demasiado. | [[Motor de agentes]] |
| **Presión de cierre** | Lo que se le dice al turno según ciclos y presupuesto restantes, para cerrar en un entregable. | [[Prompt de un turno]] |
| **Escalado por dificultad** | Elección del tier de cada turno según señales medidas, dentro de un rango. | [[Escalado por dificultad]] |
| **Turno delegado** | Turno que corre el CLI de una suscripción con su propio loop; el motor ve una sola iteración. | [[Turnos delegados a un CLI]] |
| **Puente del org** | Servidor MCP dentro del proceso del motor que le presta al CLI las herramientas del org, con sus frenos. | [[Turnos delegados a un CLI]] |
| **Freno en el ejecutor** | El límite se aplica en el `execute` de la herramienta, no en el prompt: un agente puede ignorar una instrucción, no al ejecutor. | [[Invariantes de arquitectura]] |

## Coordinación, aprobaciones y memoria

| Término | Definición | Nota |
|---|---|---|
| **Bandeja** | Los mensajes que le llegan a un rol; no comparte contexto con nadie más. | [[Coordinación entre agentes]] |
| **Entregable** (`Artifact`) | Documento versionado por clave; es de la empresa, no de la corrida, y sobrevive a que se borre su corrida. | [[Entregables]] |
| **Clave variante** | Clave nueva que es otra versión de una existente (`-v2`, `-final`); `write_artifact` la rechaza. | [[Entregables]] |
| **Solicitud** (`AgentRequest`) | Pedido de un agente a la persona (un dato, un rol, un acceso, un servidor MCP, un comando, una dependencia). | [[Aprobaciones y solicitudes]] |
| **Aprobación** (`ApprovalRequest`) | Permiso para una llamada concreta; aprobarla **la ejecuta** con los argumentos que vio la persona. Mientras haya una pendiente, la corrida espera. | [[Aprobaciones y solicitudes]] |
| **Solicitud heredada** | Pendiente de una corrida anterior que la corrida nueva carga y espera. | [[Aprobaciones y solicitudes]] |
| **Tarea heredada** | Tarea abierta que una corrida nueva adopta (`heredadaDeRunId`). | [[Supervisión y continuidad]] |
| **Herramienta compuesta** | Secuencia declarativa de hasta 6 pasos creada con `crear_herramienta` (`origin: "creada"`). | [[Herramientas compuestas]] |
| **Aprendizaje / lección** (`Learning`) | Memoria corta de la empresa que viaja en el prompt; exige evidencia al grabarse. | [[Memoria de la empresa]] |
| **Refutación** | Marca humana que saca una lección del prompt sin borrarla, con su motivo. | [[CU-12 Refutar una lección falsa]] |
| **Vault de contexto** | Carpeta de Obsidian por empresa con lo largo; al prompt sólo viaja su mapa. No es esta bóveda. | [[Vault de contexto]] |
| **Auditoría de corridas** | Chequeo posterior de la traza de una corrida (`npm run auditar`). | [[Auditoría de corridas]] |

## Modelos y costo

| Término | Definición | Nota |
|---|---|---|
| **`LlmProvider`** | Contrato que cumple todo proveedor; lo único que el motor conoce de un modelo. | [[Capa LLM y tiers]] |
| **Tier** | `free` / `cheap` / `standard` / `smart`: atajo que se resuelve contra el catálogo en vez de fijar un slug. | [[Capa LLM y tiers]] |
| **Precio mezclado** | Entrada × 0,8 + salida × 0,2 en US$/MTok; decide la banda de un modelo. | [[Capa LLM y tiers]] |
| **Mapa curado** | Tier → modelos por proveedor, para catálogos sin precios o de una sola familia (Claude). | [[Capa LLM y tiers]] |
| **`delegaElTurno`** | Proveedor que corre su propio loop por CLI y recibe el puente MCP del org. | [[Proveedor claude-code]] |
| **`claude-sesion`** | Anthropic autenticado con el token de `ant auth login`; factura como API. | [[Proveedor Anthropic y claude-sesion]] |
| **Vigilante de silencio** | Corta un CLI de Claude Code que pasa demasiado tiempo sin emitir nada. | [[Proveedor claude-code]] |
| **Rescate de turno** | Devolver lo que el CLI alcanzó a decir, con un aviso pegado, en vez de perder el turno. | [[Proveedor opencode]] |
| **Ledger** (`RunLedger`) | Acumulador del gasto de una corrida; corta con `BudgetExceededError`. | [[Costos y presupuesto]] |

## Herramientas y MCP

| Término | Definición | Nota |
|---|---|---|
| **Origen de herramienta** | `coordination`, `capability`, `skill`, `mcp` o `creada`; decide si se asigna, si compite en el router y si se siembra. | [[Catálogo de herramientas]] |
| **Habilidad** (`skill`) | Lo que un rol sabe **producir**; se asigna por `toolIds` y no se registra si la máquina no puede cumplirla. | [[Habilidades de producción]] |
| **Tool router** | Elige qué herramientas ve un rol en cada turno: fija coordinación, habilidades y creadas, y rankea el resto. | [[Herramientas y tool router]] |
| **McpBridge** | Cliente MCP del orquestador: conecta, descubre, publica la salud y reintenta, con una fila por servidor. | [[Integración MCP]] |
| **Secreto por referencia** | Se guarda el nombre de la variable de entorno, nunca el valor. | [[Integración MCP]] |
| **Servidor fantasma** | Servidor ya borrado que seguía en el Hub; se evita filtrando la salud contra la base. | [[Integración MCP]] |
| **Tienda MCP** | Catálogo curado (`CATALOGO_MCP`) instalable en un click, con las credenciales declaradas de antemano. | [[Tienda MCP]] |
| **`otorgarAlConectar`** | Roles que reciben las herramientas de un servidor cuando aparecen (servidores con OAuth). | [[OAuth para servidores MCP]] |

## Producción

| Término | Definición | Nota |
|---|---|---|
| **Salida** | `data/proyectos/<Nombre>/salida/`: los archivos reales que produce la empresa. | [[Salida de la empresa]] |
| **Manifiesto de procedencia** | `.orq-generado.json`: qué archivos generó la empresa; un agente sólo borra lo suyo. | [[Archivos de salida y permisos de borrado]] |
| **Publicar** (salida) | Mover un archivo a `publicado/`; lo decide una persona. | [[Salida de la empresa]] |
| **Bloques neutros** | Resultado de parsear el markdown una vez; de ahí salen Word, PDF, deck y video. | [[Documentos Word y PDF]] |
| **Guion** | Entregable markdown leído como línea de tiempo: `#` portada, cada `##` una escena, los párrafos voz en off. | [[Guion como línea de tiempo]] |
| **Reloj compartido** (`ubicarEscenas`) | La duración medida de la voz manda en los tres motores de video. | [[Guion como línea de tiempo]] |
| **Motor ASS / estudio / clips** | Los tres motores de video: ffmpeg + libass, láminas HTML reveladas con Chrome, y tomas reales empalmadas. | [[Producción audiovisual]] |
| **Lámina** | Una escena programada en HTML, atada a su escena por el número del nombre. | [[Motor estudio de láminas HTML]] |
| **Sesión de navegador** | Perfil de Chrome persistente con candado, que reusa el login entre tomas. | [[Navegador Chrome por CDP]] |
| **Cama musical** | Pista de fondo normalizada en sonoridad que se aparta sola cuando alguien habla (ducking). | [[Música y narración]] |
| **Marca de ícono / visual** | `:nombre:` dibuja un ícono vectorial; `visual:nombre` una composición. | [[Íconos y visuales vectoriales]] |

## Código

| Término | Definición | Nota |
|---|---|---|
| **Clon gestionado** | Copia del repo de la persona en `repos/<slug>` donde trabaja el equipo; su carpeta sólo se toca al publicar. | [[Repositorios y sesiones]] |
| **Sesión de código** | Worktree del clon, uno por repo, parado en la rama del proyecto; sobrevive a la corrida. | [[Repositorios y sesiones]] |
| **Arriendo de escritura** | Permiso en memoria para escribir en un repo durante un turno: uno escribe por vez. | [[Arriendo de escritura y resumen de código]] |
| **Resumen de código** | Bloque del prompt de cada turno con repos, comandos, servicios y si puede escribir. | [[Arriendo de escritura y resumen de código]] |
| **Instantánea** | Foto del árbol en `refs/orq/instantaneas/…` sin tocar la rama: permite ver y deshacer un pedido sin commitear. | [[Instantáneas y checkpoints]] |
| **`commitsAutomaticos`** | Ajuste por repo, apagado por defecto, que vuelve al commit por turno con el rol como autor. | [[Instantáneas y checkpoints]] |
| **Publicar** (código) | Fast-forward de lo commiteado a la rama de la persona, con `push` opcional y sin forzar. | [[Control de versiones y publicación]] |
| **Allowlist de comandos** | Comandos permitidos comparados argv a argv, sin shell; el sandbox contiene lo que la allowlist deja pasar. | [[Comandos y sandbox]] |
| **Git endurecido** | `git()` sin hooks ni config global, sin preguntar y con `--git-dir` explícito. | [[Git endurecido]] |
| **Servicio** | Parte de un monorepo que se levanta por su cuenta (`api`, `web`, `movil`, `docs`). | [[Servicios del monorepo]] |
| **Proxy de vista previa** | Puerto propio delante de un frontend que inyecta el selector y la sonda. | [[Vista previa y proxy]] |
| **Archivo sensible** | Archivo que decide qué se ejecuta (`package.json`, CI, `.sh`); se avisa antes de publicar. | [[Panel de control de código]] |
| **Mejorador de código / QA móvil** | Los dos agentes del chat del IDE que se crean con un click. | [[Chat de IA]] |

## Móvil

| Término | Definición | Nota |
|---|---|---|
| **Depuración inalámbrica** | adb por Wi-Fi, vinculado con el QR `WIFI:T:ADB;…` de Android. | [[Vinculación del teléfono]] |
| **Build de desarrollo** | La app debuggable que se instala una vez y baja el JavaScript del Metro de la sesión. | [[Build de desarrollo y túneles]] |
| **Túnel `adb reverse`** | Conecta puertos del teléfono con los de la máquina, sin exponer nada a la red. | [[Build de desarrollo y túneles]] |
| **scrcpy / espejo de respaldo** | El espejo fluido del teléfono, y el de `screenrecord` → MJPEG cuando no hay scrcpy. | [[Espejo del teléfono]] |
| **`ConsolaJs`** | La consola de JavaScript de la app, leída del depurador de Hermes por el Metro. | [[Inspector de React Native]] |
| **`manejar_app`** | Maneja la app por texto, nunca por coordenadas, y sólo sobre staging. | [[QA móvil]] |
| **Marcadores de producción** | Textos que, si aparecen en el entorno, bloquean el QA y el acceso a R2. | [[QA móvil]] |
| **Build anterior** | Contra el que se comparan el `versionCode` y el certificado del build nuevo; no se borra. | [[Build de producción Android]] |
| **Tipo real** | El formato de un objeto de R2 según sus primeros bytes, no según su `content-type`. | [[Almacenamiento R2]] |

## Observabilidad y datos

| Término | Definición | Nota |
|---|---|---|
| **Traza / evento** (`TraceEvent`) | Cada paso emite uno; se persiste con `seq` y se reemite por SSE. | [[Referencia de eventos]] |
| **`derive`** | Reconstruye el estado visible reproduciendo la traza hasta un corte: ver en vivo y retroceder son la misma operación. | [[Observabilidad y trazas]] |
| **`model.selected`** | Evento que dice qué modelo corre cada turno y por qué. | [[Referencia de eventos]] |
| **`esCorridaTerminal`** | La única lista de estados de los que una corrida no vuelve. | [[Modelo de dominio]] |
| **Store** | La clase de `db.ts`, única puerta a SQLite: documentos JSON con columnas de filtro al costado. | [[Persistencia y esquema SQL]] |
| **Residuo** | Fila que apunta a una empresa o corrida inexistente; el barrido anuncia exactamente lo que borra. | [[Limpieza y mantenimiento]] |
| **Misión** | La receta de una corrida más cuándo repetirla; el próximo disparo (`proximaAt`) se guarda en la base. | [[Misiones programadas]] |
| **Marca `.empresa`** | Archivo oculto con el id que dice de qué proyecto es una carpeta. | [[Directorios en disco]] |
