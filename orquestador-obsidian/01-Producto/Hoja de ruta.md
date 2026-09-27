---
tags: [producto]
aliases: [Roadmap, Próximos pasos, Pendientes]
---

# Hoja de ruta

No es un compromiso de fechas: es la lista de lo que hoy falta, con el motivo y
dónde se tocaría. Lo hecho vive en [[Estado del producto]]. Cada ítem está
verificado contra el código actual: si figura como pendiente, es porque el código
todavía no lo hace.

## Prioridad alta — huecos verificados

### 1. Continuar una corrida después de un reinicio

El estado vivo (`RunState`, el orquestador) está en memoria. Hoy se hereda el
**trabajo abierto** (tareas y solicitudes pendientes) pero el turno en vuelo y
la conversación se pierden, y `tsx watch` reinicia con cualquier edición.
Falta materializar el estado para **continuar**, no sólo reproducir. Toca
`packages/engine/src/state.ts` y `apps/server/src/runtime.ts`.

### 2. Tope de gasto durante la llamada

`ledger.assertWithinBudget()` corre antes de cada turno y de cada iteración:
una sola llamada cara se puede pasar. Falta cortar por streaming o estimar el
costo antes de llamar.

### 3. Tests de lo que hoy no tiene

- `apps/server/src/misiones.ts` (planificador de misiones);
- `persistMcpTools` salteando las herramientas `creada`, y el router
  exponiéndolas siempre (las dos defensas están en el código sin test propio);
- el `Runtime` en pausa, stop y reconexión MCP;
- reintentos ante 429/5xx de los adaptadores HTTP;
- `esCorridaTerminal` y `mcpHealth` filtrando servidores borrados.

### 4. Claves variante por prefijo

`write_artifact` ataja `-v2`, `-final`, `-ciclo3` y sufijos colgados, pero no un
prefijo: `informe-ia-pymes` y `ia-pymes` conviven como dos entregables (guardia
`raiz()` en `packages/tools/src/coordination.ts`).

## Prioridad media — calidad de lo que ya funciona

- **Tareas `blocked` que nadie despierta.** `rolesWithWork` sólo cuenta
  `pending` e `in_progress`: el dueño de una tarea bloqueada vuelve a trabajar
  sólo si alguien le escribe (`packages/engine/src/state.ts`).
- **Pantalla de misiones.** Hoy se crean por API (`/api/companies/:id/misiones`).
- **Preparar dependencias al abrir una sesión.** El comando `preparar` del repo
  existe pero no corre solo; los servicios se preparan a pedido.
- **Proveedor de imágenes funcionando.** Sin `GOOGLE_API_KEY` u
  `OPENAI_API_KEY`, `generar_imagen` no se registra y los videos salen sin fotos
  generadas (el endpoint de NVIDIA no responde; hay corte de 90 s).
- **Poda de instantáneas.** Las refs `refs/orq/instantaneas/…` se acumulan en el
  clon sin límite ([[ADR-010 Los agentes no commitean y la persona publica]]).
- **Contención de red en los comandos.** El sandbox niega escrituras y lecturas
  de secretos, no conexiones ([[ADR-011 La allowlist decide y el sandbox contiene]]).
- **Sandbox fuera de macOS** con el mismo contrato (`escribibles`,
  `noEscribibles`, secretos ilegibles).
- **Permisos de borrado más finos**: hoy `puedeBorrar` resuelve por autoridad en
  tres niveles; falta "este rol puede borrar en esta carpeta".
- **Migraciones versionadas**, cuando una columna haya que renombrarla o mover
  datos: el lugar reservado es `apps/server/src/migrate.ts`.
- **Tests de interacción de la UI** (IDE, organigrama, tienda).

## Prioridad baja — sólo si aparece la necesidad

- Un linter: hoy `typecheck` estricto alcanza.
- Compilar los `packages/`: consumirlos desde `src/` con tsx y Vite no tiene
  costo hoy.
- Más íconos y visuales vectoriales: agregar uno es un trazo en una caja de
  100×100 ([[Íconos y visuales vectoriales]]).

## Descartado a propósito

No son omisiones: se evaluaron y se rechazaron. El motivo importa tanto como la
decisión.

| Idea | Por qué no |
|---|---|
| Claude Agent SDK como motor | ata a modelos Anthropic y esconde el loop que se instrumenta ([[ADR-001 No usar Claude Agent SDK]]); las suscripciones entran como turnos delegados ([[ADR-018 Los CLI de suscripción reciben el puente MCP del org]]) |
| Navegador headless para las placas de texto del video | 150 MB para lo que libass ya dibuja; Chrome se usa sólo donde hace falta, y el instalado ([[ADR-012 Usar el Chrome instalado por CDP]]) |
| Emojis en los videos | libass los dibuja en monocromo o los saltea según la fuente ([[Íconos y visuales vectoriales]]) |
| Que el orquestador descargue música | la música tiene licencia ([[Música y narración]]) |
| Un archivo por versión de entregable | v1, v2 y v3 conviviendo; la versión va en la portada |
| Que un agente publique archivos | "aprobado" tiene que ser un hecho en el disco ([[ADR-008 Publicar lo decide una persona]]) |
| Que un agente commitee o publique código | la historia de la rama es de la persona ([[ADR-010 Los agentes no commitean y la persona publica]]) |
| Un `git worktree` directo sobre el repo de la persona | escribe en su `.git` y dispara sus hooks ([[ADR-009 Programar sobre un clon gestionado y un worktree]]) |
| Shell libre para los agentes, o `Bash` en el CLI | permitir `npm test` ya es correr código del agente; el sandbox es la frontera ([[ADR-011 La allowlist decide y el sandbox contiene]]) |
| Un `adb shell` libre | el teléfono es de una persona ([[Depuración de la app móvil]]) |
| Tocar la app por coordenadas | la pantalla se corre y el toque cae en otro lado ([[QA móvil]]) |
| Escribir el vault por el plugin de Obsidian | el contexto no puede depender de una app de escritorio abierta ([[ADR-013 El vault de contexto se escribe por el sistema de archivos]]) |
| Herramientas con código del agente | necesitan sandbox y aprobación; componer basta ([[ADR-020 Herramientas compuestas declarativas]]) |
| Guardar secretos de MCP o de servicios en la base | una empresa exportada llevaría credenciales ([[Seguridad]]) |
| SMTP directo | el flujo de n8n decide con qué cuenta sale ([[ADR-007 Correo por webhook de n8n]]) |
| Memoizar lecturas entre turnos | la conversación del CLI se reinicia: el puntero apuntaría a la nada |
| El SDK de AWS para leer R2 | 3 MB para dos verbos ([[ADR-021 R2 sin SDK con SigV4 propio]]) |

## Ver también

- [[Estado del producto]] · [[Decisiones de arquitectura]] · [[Guía de contribución]]
