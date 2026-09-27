---
tags: [capacidad, plataforma]
aliases: [Correo, n8n, send_email, correo.ts, crearCorreo, createEmailTools, N8N_EMAIL_WEBHOOK_URL]
---

# Correo y avisos

El orquestador manda correo de dos formas: una **misión** avisa sola cuando su
corrida termina, y un agente con `send_email` asignada puede escribirle a alguien
de afuera. Las dos salen por el mismo lado: un webhook de n8n.

## Por qué por n8n y no por SMTP

Un cliente ya tiene su n8n con las credenciales puestas y sus reglas de envío.
Duplicar eso acá sería pedir una contraseña de aplicación, guardarla y mantener
un cliente SMTP, para terminar mandando el mismo mail. El orquestador le pasa el
mensaje al flujo y el flujo decide con qué cuenta sale. Ver
[[ADR-007 Correo por webhook de n8n]].

## El contrato

`packages/tools/src/correo.ts` → `crearCorreo({ webhookUrl, timeoutMs })`.
`POST` a `N8N_EMAIL_WEBHOOK_URL` con `content-type: application/json`:

```json
{
  "to": ["persona@empresa.com"],
  "subject": "…",
  "text": "…",
  "attachments": [{ "filename": "video.mp4", "url": "http://…/api/companies/<id>/exports/marketing/video.mp4" }],
  "source": "orquestador-agentico"
}
```

- Los campos van en inglés porque son los del nodo *Send Email* de n8n: del otro
  lado es un **mapeo**, no una traducción. `source` sirve para filtrar si el mismo
  webhook recibe de varios lados.
- **Los adjuntos viajan como enlace, no como bytes**, al servidor local: se abren
  desde la misma máquina o red donde corre el orquestador, no desde cualquier
  lado. Los entregables no salen a internet por un aviso automático.
- `Correo` expone `configurado` (hay webhook) y `enviar(mensaje)` →
  `{ ok: true } | { ok: false, motivo }`. Nunca tira.

| Situación | Resultado |
|---|---|
| sin `N8N_EMAIL_WEBHOOK_URL` | `ok: false`: "falta N8N_EMAIL_WEBHOOK_URL en el .env del servidor. Es algo que resuelve quien opera la empresa, no un agente." |
| `to` vacío | "Falta el destinatario." |
| el flujo responde ≠ 2xx | "El flujo de correo respondió `<status>`: `<200 caracteres del cuerpo>`" |
| red caída o más de 15 s | "No se pudo llegar al flujo de correo: …" |

Hay **una** salida de correo por servidor (`Runtime.correo`), compartida por
misiones y agentes.

## Uso 1: el aviso de una misión

`apps/server/src/misiones.ts` → `MisionScheduler.avisarAlTerminar`. Si la misión
tiene `avisarA`, después de largar la corrida sondea su estado cada 15 s (hasta
6 horas) hasta uno terminal (`completed`, `stopped`, `failed`,
`budget_exceeded`) y manda:

- asunto `[<misión>] listo para revisar | se detuvo | falló | se quedó sin presupuesto`;
- cuerpo con la programación, el resultado y los ciclos, los archivos que dejó
  **esta** corrida (modificados desde su inicio) y los títulos de sus entregables;
  si no produjo nada, lo dice; cierra con "Qué tenés que decidir: si esto se
  publica o no" y "Nada se publica solo";
- un adjunto por archivo nuevo.

Sondea en vez de escuchar el bus porque el aviso tiene que salir igual si la
corrida muere por presupuesto o por error, caminos que no emiten lo mismo. Si el
envío falla, se registra en la consola del servidor y la misión sigue. Ver
[[Misiones programadas]] y [[CU-03 Misión semanal con aprobación humana]].

> [!note] Dos bases de URL distintas
> El aviso de misión arma sus enlaces con `APP_URL` (la UI; `/api` llega al
> servidor por el proxy de Vite) y `send_email` con `API_URL` (el servidor
> directo, por defecto `http://localhost:<PORT>`). Si cambiás uno, revisá el otro.

## Uso 2: `send_email`, la herramienta

`createEmailTools(correo, urlDeSalida)`, registrada **por empresa** en
`Runtime.companyRuntime` porque el enlace de un adjunto lleva el id de la
empresa: `urlDeSalida(ruta) = ${API_URL}/api/companies/<id>/exports/<ruta>`.

- Origen `capability`: mandar un correo es una acción hacia afuera, no un
  entregable. Se asigna por `toolIds` y compite en el ranking.
- Argumentos: `para*` (lista), `asunto*`, `cuerpo*`, `adjuntos` (rutas de la
  salida). La descripción le pide escribir para alguien que no vio la corrida y
  usar `send_message` para hablar con otro agente.
- Filtra direcciones con `^[^\s@]+@[^\s@]+\.[^\s@]+$`: manda a las válidas y dice
  a cuáles no; si no hay ninguna válida, falla.
- Se registra **aunque no haya webhook**: la falla dice exactamente qué falta y de
  quién es el problema, que es más útil que no ofrecerla.

> [!warning] Límites
> - No verifica que las rutas de `adjuntos` existan: un nombre mal escrito viaja
>   como enlace roto.
> - `requiresApproval: false` y no hay forma de cambiarlo desde la configuración:
>   la columna de la base es un espejo (ver [[Herramientas y tool router]]). Si en
>   una empresa un correo mal mandado tiene costo, no se la asignes a nadie, o
>   cambiala en `correo.ts`.

## El flujo mínimo de n8n

Nodo *Webhook* (POST) → nodo *Send Email* mapeando `to`, `subject`, `text` y los
`attachments` (si hacen falta como archivo, un *HTTP Request* baja cada `url`
antes). Como los enlaces apuntan al servidor local, n8n tiene que poder llegar a
esa dirección para bajarlos.

## Variables de entorno

`N8N_EMAIL_WEBHOOK_URL` (sin ella no hay correo), `API_URL`, `APP_URL`,
`MISION_TICK_MS`. Ver [[Variables de entorno]].

## Qué fijan los tests

No hay tests de `correo.ts`. El planificador de misiones se prueba sin reloj
(`vencidas`), pero el aviso por correo no tiene test propio.

## Fuentes

- `packages/tools/src/correo.ts` → `crearCorreo`, `createEmailTools`, `Correo`, `Mensaje`, `Adjunto`
- `apps/server/src/misiones.ts` → `avisarAlTerminar`, `cuerpoDelAviso`, `etiquetaDeEstado`
- `apps/server/src/runtime.ts` → `correo`, `companyRuntime`
- `apps/server/src/env.ts` → `emailWebhookUrl`, `apiUrl`, `appUrl`

## Ver también

- [[ADR-007 Correo por webhook de n8n]] · [[ADR-008 Publicar lo decide una persona]]
- [[Misiones programadas]] · [[CU-03 Misión semanal con aprobación humana]]
- [[Referencia de herramientas]]
