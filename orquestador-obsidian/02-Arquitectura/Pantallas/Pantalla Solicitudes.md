---
tags: [arquitectura, pantalla]
aliases: [Requests.tsx, Requests, Bandeja de solicitudes, RequestCard]
---

# Pantalla Solicitudes

**Ruta:** `/p/:companyId/solicitudes`. **Componente:**
`apps/web/src/routes/Requests.tsx` → `Requests`.

Los agentes coordinan entre ellos por mensajes, pero hay cosas que no pueden
resolver adentro: incorporar a alguien, conocer un dato del negocio, obtener una
herramienta, conectar un servidor, correr un comando o instalar una librería.
Eso llega acá con una decisión pendiente. **Aprobar no es marcar una casilla**:
crea el rol, otorga las herramientas, conecta el servidor, permite el comando,
instala el paquete o le hace llegar la respuesta al agente. Qué hace cada tipo por
dentro: [[Aprobaciones y solicitudes]].

Las **aprobaciones de herramientas** (una tool con `requiresApproval` que espera
a una persona) no están acá: van en la pestaña Aprobaciones de
[[Pantalla Proceso en vivo]] y en el chat del IDE.

## Datos

`["requests", companyId]` → `GET /api/companies/:id/requests` cada **4 s**,
también en segundo plano. El servidor ordena pendientes primero y, dentro de cada
grupo, lo más nuevo arriba. Después de resolver se invalidan `requests`,
`company` (un rol o una herramienta nueva) y `learnings` (una respuesta puede
terminar en la memoria).

## Disposición

`grid-cols-[1fr_340px]`: a la izquierda **Pendientes de tu decisión (N)** con la
leyenda "aprobar aplica el cambio de verdad"; a la derecha **Ya resueltas (N)**.

Vacío de pendientes: "No hay solicitudes pendientes. Los agentes pueden pedirte
incorporar un rol, un dato del negocio, acceso a una herramienta o conectar un
servidor MCP mientras trabajan."

## Una solicitud pendiente (`RequestCard`)

Encabezado con el ícono y el tipo, "pedido por <agente>", hace cuánto, y el
**motivo** (`reason`), que es lo que se lee para decidir. Después, según el tipo:

| Tipo | Ícono | Qué se muestra | Botón |
|---|---|---|---|
| `create_role` "incorporar un rol" | `UserPlus` | la propuesta **editable**: nombre, cargo, departamento ("Si no existe, se crea."), a quién reporta, instrucciones. El agente sugiere, la persona ajusta y acepta | crear el rol |
| `context` "consulta de negocio" | `HelpCircle` | la pregunta. La respuesta es **obligatoria** para aprobar | responder |
| `tool_access` "acceso a herramientas" | `KeyRound` | las herramientas pedidas; las que no existen en el catálogo van en amarillo con ⚠: "se ignora al aprobar" | otorgar acceso |
| `mcp_server` "conectar un servidor MCP" | `Plug` | los servidores propuestos con su comando o URL y la aclaración: la propuesta viene **saneada** (los secretos literales se descartaron en la herramienta), la credencial se carga en el `.env`, y al aprobar se conecta de verdad y sus herramientas quedan asignadas a quien las pidió | conectar el servidor |
| `comando` "correr un comando" | `Terminal` | el argv; **sólo esta vez, exacto** o **permitir siempre, con el prefijo**; con más de un token, un deslizador recorta el prefijo (lo que queda afuera se tacha) | permitir |
| `dependencia` "instalar dependencias" | `PackagePlus` | gestor, si es de desarrollo, y cada paquete enlazado a npmjs.com (sin la versión) para mirarlo antes; se instala en el sandbox, **sin scripts de instalación**, y queda en `package.json` | instalar ("instalando…") |

Por qué el prefijo es recortable: pidieron `npm run e2e -- --grep x` y lo que
tiene sentido permitir es `npm run e2e`. La tarjeta recuerda que permitir un
comando es permitir lo que corre (con `npm test` corren los tests que escribió el
agente): lo contiene el sandbox, no la lista, y los prefijos que lo permiten todo
(`npx`, `bash`, `npm run` a secas) se rechazan. Ver [[Comandos y sandbox]] e
[[Instalación de dependencias]].

Abajo, un campo de texto: **Tu respuesta** en una consulta ("Le llega al agente a
su bandeja y puede seguir trabajando con esto.") o **Comentario (opcional)** en
el resto, que es también el motivo de un rechazo. **rechazar** siempre está
disponible.

Resolver → `POST /api/companies/:id/requests/:reqId` con `decision`,
`resolution`, la propuesta de rol (editada) y, para un comando,
`{alcance, prefijo}`. El servidor contesta 409 si ya estaba resuelta y 400 si
aplicarla falló (una instalación que no terminó deja la solicitud pendiente:
aprobar algo que no quedó instalado le mentiría al agente); el error se muestra
en la tarjeta. Al terminar, si la corrida esperaba esa respuesta, **sigue sola**.

### Dónde terminó la respuesta

La respuesta del servidor trae `entrega`, y la pantalla lo dice en un banner:

| `entrega` | Texto |
|---|---|
| `bandeja` | "Le llegó a la bandeja del agente: lo va a leer en el próximo ciclo." |
| `memoria` | "Su corrida ya había terminado, así que la respuesta quedó en la memoria de la empresa. Entra sola en el prompt de la próxima corrida." |
| `descartada` | "No se pudo entregar: la solicitud no tiene autor o quedó sin respuesta escrita." |

Importa decirlo: si la corrida del agente ya cerró, la respuesta no le entra por
la bandeja, y dar a entender que alguien la está leyendo sería falso. El banner
queda hasta la próxima resolución.

## Ya resueltas

Tipo, estado **resuelta** (verde) o **rechazada** —en amarillo y no en rojo:
rechazar es una decisión tuya, no una falla del sistema, y pintarla como error
hacía parecer que algo se había roto—, un resumen (el nombre del rol, la
pregunta, el comando, los paquetes, los servidores o las herramientas), el autor y
hace cuánto.

## Casos borde

- Un comando de un solo token no muestra deslizador: el prefijo es el comando.
- Lo que el servidor devuelve en `aplicado` (qué creó u otorgó) no se muestra.
- Borrar un agente desde [[Pantalla Empresa y organigrama]] se lleva sus
  solicitudes pendientes (y el editor avisa cuántas).

## Qué fijan los tests

No hay tests de la pantalla. `apps/server/src/db.test.ts` fija la cascada de
solicitudes al borrar un rol; los tipos y su validación, los tests de
`packages/shared` (`argv.test.ts`, `dependencias.test.ts`, `mcp-config.test.ts`).

## Fuentes

- `apps/web/src/routes/Requests.tsx` — `Requests`, `RequestCard`, `ETIQUETA`,
  `ICONO`, `resumenTransporte`.
- `apps/web/src/api.ts` — `requests`, `resolveRequest`.
- `apps/server/src/routes.ts` — `GET` y `POST /api/companies/:id/requests`.
- `packages/shared/src/schema.ts` — `agentRequestSchema`,
  `agentRequestTypeSchema`.

## Ver también

- [[Aprobaciones y solicitudes]]
- [[Especialistas convocados]] — incorporar sin esperar
- [[Memoria de la empresa]] — a dónde va una respuesta tardía
- [[Pantalla Proceso en vivo]] — aprobaciones de herramientas
