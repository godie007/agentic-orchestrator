---
tags: [producto]
aliases: [Estado, Madurez, Qué está verificado]
---

# Estado del producto

Versión `0.1.0`, privado, monorepo npm, Node ≥ 22. Licencia PolyForm
Noncommercial 1.0.0 (uso comercial con licencia aparte).

Este estado distingue tres niveles, porque no son lo mismo:

- **Test**: un caso de `vitest` fija el comportamiento, sin gastar tokens.
  Hay unos **70 archivos de test** repartidos en los seis workspaces.
- **Corrida medida**: se observó en una corrida real (con los números en
  `CLAUDE.md` o en los comentarios del código). No se repite solo.
- **Sin verificar**: está en el código pero no hay ni test ni corrida que lo
  sostenga, o lo que se probó es parcial.

## Área por área

| Área | Fijado por tests | Visto en corridas medidas | Sin verificar / límites |
|---|---|---|---|
| **Organización y coordinación** | jerarquía, `send_message` sin insistir, `assign_task` sin duplicar, convocar especialistas, `estado_del_proceso`, `check_activity` (`coordination.test.ts`) | encargos descompuestos y delegados a cuatro áreas; revisor que forzó correcciones reales | que un revisor en `free` verifique de verdad: medido que no |
| **Motor y ciclo** | cadena por ciclo, orden por urgencia, pausa, corrida vacía = `failed`, corte por proveedor caído, atribución con 4 agentes en paralelo (`scheduler.test.ts`, `continuidad.test.ts`, `loop.test.ts`) | cadenas guion → rodaje → revisión en un ciclo; livelocks y turnos colgados que motivaron los cortes | las corridas no sobreviven a un reinicio (el trabajo abierto sí se hereda) |
| **Aprobaciones y solicitudes** | aprobar ejecuta con los argumentos aprobados; rechazar no ejecuta; retomar al resolver (`scheduler.test.ts`) | migración aprobada y aplicada desde el chat del IDE | aprobar ejecuta aunque el mundo haya cambiado desde el pedido |
| **Memoria gobernada** | evidencia obligatoria, confirmación por otro autor, refutar sin borrar, procedencia en el prompt, filas viejas (`memory.test.ts`, `coordination.test.ts`, `routes.test.ts`, `memoria-persistida.test.ts`) | entregable que citó la memoria sembrada en vez de re-derivarla | la calidad de la evidencia no se juzga; la refutación depende de que alguien mire |
| **Auditoría** | cinco reglas de `auditarCorrida` (`auditoria.test.ts`) | — | no detecta a quien ejecutó *algo* pero entregó lo equivocado |
| **Vault de contexto** | rutas saneadas, `.md` forzado, mapa sin contenido, legible desde Obsidian, renombre (`contexto.test.ts`, `renombrar.test.ts`) | 465 tokens de mapa apuntando a 59.743 caracteres | el espejo de la memoria pisa ediciones a mano |
| **Capa LLM y tiers** | bandas, mapa curado de Claude, costo informado, registro de proveedores, caché de prompt (`modelos-claude.test.ts`, `ledger.test.ts`, `registry.test.ts`, `caching.test.ts`) | catálogo vivo de OpenRouter; ruteo por precio con 99% de caché | corrida larga con OpenRouter **pago**: no se re-verificó (la cuenta usada quedó sin crédito) |
| **Escalado por dificultad** | función pura y monótona, slug fijo gana, `model.selected` en todo turno (`dificultad.test.ts`, `loop.test.ts`) | equipos en Opus para quien decide y Sonnet para quien ejecuta | cortes de dificultad elegidos a mano |
| **CLIs de suscripción** | permisos de `claude-code` y `opencode` (sin `Bash`, salida en sólo lectura), rescate del texto, fallback, vigilante de silencio, puente MCP con memo y topes (`claude-code.test.ts`, `opencode.test.ts`, `claude-mcp.test.ts`) | corridas enteras por la suscripción de Claude; opencode con el tier `free` de Zen | el costo bajo suscripción se reporta en 0: el presupuesto no lo frena |
| **Documentos** | Word y PDF con portada, numeración, tablas, emojis fuera, un archivo por formato, gate de cifras (`skills.test.ts`, `gate.test.ts`) | propuestas y informes exportados en corridas | — |
| **Video y deck** | parser del guion y sus trampas, íconos, visuales, voces, música, deck, láminas, clips (`guion.test.ts`, `estudio.test.ts`, `clips.test.ts`, `medios.test.ts`) | videos institucionales narrados con música; un tutorial filmado sobre una app real con QA por cuadros | generación de imágenes: sin proveedor funcionando en la máquina medida (NVIDIA no responde) |
| **MCP** | pegar configuración, secretos por referencia, tienda validada, cascada al borrar, fila con límite de tasa, OAuth en archivo 0600 (`mcp-config.test.ts`, `tienda-mcp.test.ts`, `db.test.ts`, `bridge.test.ts`, `mcp-oauth.test.ts`) | Brave, Supabase de staging con OAuth y escrituras con aprobación | la conexión real de cada servidor del catálogo no está probada uno por uno |
| **Plantillas de equipo** | esquema, jerarquía, un executive, rangos, MCP existentes, castellano, materialización real (`plantillas.test.ts`, `equipo.test.ts`) | equipo de software sobre un monorepo real | — |
| **Misiones y correo** | cálculo del próximo disparo (`programacion.test.ts`) | circuito misión → aviso → publicar | `misiones.ts` sin tests; no hay pantalla de misiones (se crean por API) |
| **Código: repos y sesiones** | `.git` de la persona intacto, exclusiones, rama del proyecto, integrar sin pisar, instantáneas, copias sin git, respaldos (`repos.test.ts`, `scm.test.ts`) | diagnóstico, edición, tests e integración con equipo de 4 roles por suscripción | sandbox sólo en macOS |
| **Comandos y dependencias** | tokenización, allowlist por token, sandbox, entorno limpio, grupo de procesos, caché por huella, dependencias sólo del registro (`argv.test.ts`, `codigo.test.ts`, `dependencias.test.ts`, `ide.test.ts`) | 24 `npm test` redundantes que motivaron la caché | el sandbox no corta la red |
| **IDE** | chat como corrida enfocada, deshacer, vista previa con CSP, CORS, conversaciones, notas de Obsidian, markdown del chat (`ide.test.ts`, `conversacion.test.ts`, `Nota.test.tsx`, `Markdown.test.tsx`) | señalar un botón en la vista previa y que el agente vaya al archivo correcto | la UI del IDE no tiene tests de interacción |
| **Servicios y vista previa** | detección de monorepo, URLs locales reescritas, secretos tapados, proxy con selector e inspector (`servicios.test.ts`, `proxy-vista.test.ts`, `sonda.test.ts`) | backend, frontend y app Expo levantados sobre la sesión | `preparar` (instalar dependencias) no corre solo al abrir la sesión |
| **Móvil** | vinculación por QR, túneles que se corrigen, espejo (protocolo scrcpy), depuración acotada a la app, QA por texto y sólo staging (`dispositivos.test.ts`, `scrcpy.test.ts`, `ws.test.ts`, `depuracion-movil.test.ts`, `qa-movil*.test.ts`, `pasos-app.test.ts`) | espejo a ~55 fps en un Galaxy S24; crashes nativos reales encontrados con las herramientas | un solo modelo de teléfono medido; red del teléfono no se puede cortar desde el sistema |
| **Build Android** | manifiesto AAB y APK, certificado, bundle sin URLs de desarrollo, borrar builds (`aab.test.ts`) | AAB de producción firmado y verificado | subir a Play es manual |
| **R2** | firma SigV4 contra vectores de AWS, lote de 20, tipo real, producción negada (`r2.test.ts`) | — | sólo lectura, sólo staging |
| **Datos y limpieza** | entregables que sobreviven a su corrida, residuos exactos, corridas huérfanas, carpetas por marca, renombrar (`db.test.ts`, `exports.test.ts`, `directorios.test.ts`) | — | no hay migraciones versionadas (el esquema es idempotente) |
| **UI general** | progreso de una corrida, nombres de modelo (`progreso.test.ts`, `modelo.test.ts`) | — | pantallas sin tests de componentes |

## Limitaciones conocidas

| Limitación | Consecuencia práctica |
|---|---|
| El estado vivo de una corrida está en memoria | un reinicio (incluido `tsx watch` al editar el servidor) corta el turno en vuelo; las tareas abiertas se heredan en la corrida siguiente |
| El presupuesto se evalúa antes de cada iteración, no durante la llamada | una llamada cara puede pasarse del tope; configurá también un límite en el proveedor |
| Bajo suscripción el costo es 0 | el presupuesto no frena turnos de `claude-code`; el límite es la ventana de la suscripción |
| Sandbox de comandos sólo en macOS | en otra plataforma, cada repo necesita `sinAislamiento` |
| El espejo fluido necesita `scrcpy` instalado | sin él, el respaldo MJPEG a ~20 fps |
| `data/musica/` viene vacía | los videos salen sin música hasta que haya pistas; `npm run musica:cama` sintetiza dos |
| No hay linter | `npm run typecheck` es la puerta |

## Aviso de seguridad abierto

`npm audit` reporta `GHSA-frvp-7c67-39w9` sobre `@hono/node-server`, arrastrado
por el SDK de MCP. **No es alcanzable** —se importa sólo el lado cliente— y
forzar el override de major puede romper el SDK. Detalle en `package.json` →
`auditNotes`. Ver [[Seguridad]].

## Ver también

- [[Hoja de ruta]] · [[Trampas conocidas]] · [[Pruebas y calidad]] · [[Invariantes de arquitectura]]
