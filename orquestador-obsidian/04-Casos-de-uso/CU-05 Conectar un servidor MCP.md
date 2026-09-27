---
tags: [caso-de-uso, mcp]
aliases: [CU-05, Conectar herramientas, pegar JSON MCP]
---

# CU-05 Conectar un servidor MCP

**Qué se quiere lograr:** sumarle a la empresa herramientas que no están
construidas adentro —una base de datos, una API, un navegador— pegando la
configuración que publica el servidor, y dárselas a los roles que las necesitan.

Si el servidor está en el catálogo, es más corto instalarlo desde la tienda
([[CU-10 Instalar un servidor desde la tienda]]). Este caso es para todo lo demás.

## Antes de empezar

- La credencial va en el `.env` del servidor del orquestador **con un nombre**
  (por ejemplo `MCP_INTERNO_TOKEN`), y el servidor se reinicia para que
  `process.env` la vea.
- `npx`/`uvx`/el comando que use el servidor tienen que estar en el `PATH` del
  proceso del orquestador.

## 1. Pegar la configuración

Pestaña **MCP** → **+ pegar JSON**. Se pega el bloque del README, el mismo que ya
usás en Claude o en Cursor:

```jsonc
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_PERSONAL_ACCESS_TOKEN" }
    },
    "interno": {
      "url": "https://mcp.interno.empresa/",
      "headers": { "Authorization": "${MCP_INTERNO_TOKEN}" }
    }
  }
}
```

Mientras escribís, `parsearConfigMcp` muestra qué va a crear y sus avisos:

- un valor que parece un nombre (`GITHUB_TOKEN`, `${X}`, `$X`) entra como
  **referencia**;
- un valor que parece un secreto (`ghp_…`) **no se guarda** y se avisa por qué:
  ponelo en el `.env` con un nombre y dejá acá el nombre;
- un nombre que no sirve como id se normaliza (`"Mi Servidor"` → `mi-servidor`)
  y se avisa;
- `url` → HTTP, `command` → stdio; `type` y `disabled` se ignoran.

**conectar N servidores** hace un `POST …/mcp-servers` por cada uno, que valida,
rechaza un nombre repetido (409, porque es parte del nombre de cada tool) y
**espera el handshake**. Detalle en [[Integración MCP]].

> [!note] Lo que el alta de la UI no ofrece
> `autoApproveTools` (queda en `true`), `enabled`, `caPath` (una CA propia para
> HTTPS interno) y `otorgarAlConectar` se cargan por la API:
> `PATCH /api/companies/:companyId/mcp-servers/:id`. Cambiar la fila reconecta el
> servidor.

## 2. Ver el semáforo

La tarjeta del servidor pasa de `connecting` a `ready` con la latencia del
handshake, cuántas herramientas descubrió, invocaciones y errores. El estado
llega por SSE (`/api/mcp/stream`) además del polling de 10 s.

- **`reconnecting` con "reintento #N"**: no pudo conectar (comando, paquete,
  red, CA) y reintenta con backoff hasta cada 60 s. El motivo está en el recuadro
  rojo (`lastError`).
- **`error` con botón Autorizar**: el servidor HTTP pide iniciar sesión. Seguí
  [[OAuth para servidores MCP]].

## 3. Probar sin arrancar la empresa

Panel **Probar una herramienta**: elegís la tool, pasás los argumentos en JSON
(la ayuda lista los campos del esquema) y ves qué devuelve
(`POST …/mcp/probe`). Es la forma más barata de descartar que el problema sea del
servidor y no del agente: hacelo **antes** de gastar una corrida. Corre como el
primer rol de la empresa y no pide aprobación: la ejecutás vos.

## 4. Dar acceso

Conectar no le da las herramientas a nadie. La matriz **"Quién usa qué"** es
también el editor: un clic en una celda le da (o le quita) a ese rol **todas** las
herramientas de ese servidor. También se puede elegir de a una desde el rol, en
Empresa. Cualquiera de los dos caminos llega a una corrida que ya está andando.

El catálogo de herramientas marca en amarillo las que están "sin asignar" y en
violeta las que "requiere aprobación".

## 5. Usarlas en una corrida

El agente las ve como `mcp__github__create_issue`. `tool.selection` deja
registrado si entraron en el turno: las de MCP compiten por 12 lugares contra las
otras opcionales ([[Herramientas y tool router]]).

## Variante: lo pide un agente

Con `solicitar_servidor_mcp` un agente pega el mismo bloque. Se sanea en la
herramienta (los secretos no llegan a la bandeja), la persona lo aprueba en
**Solicitudes**, se instala esperando el handshake y las herramientas le llegan
asignadas al que las pidió, también en su corrida viva. Ver
[[Aprobaciones y solicitudes]].

## Qué mirar

| Dónde | Qué demuestra |
|---|---|
| `handshakeMs` | si tarda segundos, cada reconexión lo paga |
| invocaciones / errores | cuáles se usan de verdad. Una tool con 0 invocaciones en varias corridas es contexto que se paga y no rinde |
| `tool.selection` | si el agente la tuvo a mano o el router la dejó afuera |
| la traza (`tool.start`/`tool.end`) | qué devolvió cada llamada, con su `mcpServerId` |

## Qué puede salir mal

| Síntoma | Causa |
|---|---|
| `reconnecting` indefinido | comando mal escrito, paquete inexistente, `npx`/`uvx` fuera del `PATH`, `caPath` inexistente |
| se conecta pero falla la auth | la variable no está en el `.env` o el servidor no se reinició después de agregarla |
| el aviso "traía un valor literal y no se guardó" | pegaste el token: movelo al `.env` y dejá su nombre |
| `ready` y el agente no las usa | nadie las tiene asignadas, o la tarea no las menciona y el router eligió otras |
| el agente insiste con una ruta fuera del directorio permitido | el corte por repetición lo frena a la tercera ([[Motor de agentes]]) |
| certificado rechazado en un servidor interno | falta `caPath` |
| un servidor borrado sigue en la lista | ya no pasa: la lista autoritativa es la base (servidor fantasma, [[Integración MCP]]) |
| `npm audit` marca `@hono/node-server` | no es alcanzable: leé `package.json` → `auditNotes` antes de "arreglarlo" |

## Quitarlo

**quitar** borra en cascada: desconecta el proceso, borra sus herramientas, poda
los `toolIds` de los roles y borra los tokens OAuth si había.

## Enlaces

- [[Integración MCP]] · [[Herramientas y tool router]] · [[Pantalla Hub MCP]]
- [[Tienda MCP]] · [[OAuth para servidores MCP]] · [[Seguridad]]
