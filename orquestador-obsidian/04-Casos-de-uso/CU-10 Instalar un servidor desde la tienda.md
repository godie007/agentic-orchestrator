---
tags: [caso-de-uso, mcp]
aliases: [CU-10, instalar desde la tienda, Brave desde la tienda]
---

# CU-10 Instalar un servidor desde la tienda

**Qué se quiere lograr:** que los investigadores de una empresa busquen en la web
con Brave Search, sin pegar ningún JSON, y que lo usen en la corrida que ya está
andando.

Es el caso que dejó la regla de "lo que editás tiene que llegar a la corrida":
Brave instalado, `ready`, con sus herramientas otorgadas a los tres roles, y una
corrida entera insistiendo con `web_search` sin una sola invocación a Brave.

## 1. La credencial, por su lado

La tarjeta de Brave Search muestra `BRAVE_API_KEY · falta`. La clave se pone en
el `.env` del servidor del orquestador y **se reinicia el servidor**: la tienda
lee `process.env`, que se carga al arrancar. Acá nunca se pega un secreto.

## 2. Instalar

Pestaña **Tienda** → categoría *Web y búsqueda* → **instalar**. Si faltara la
variable, el botón avisa que instala igual pero no va a autenticar.

Del lado del servidor (`Runtime.instalarServidoresMcp`): dedupe por nombre, aviso
por cada variable obligatoria que falte, alta con `catalogoId: "brave-search"`,
conexión **esperando el handshake**, descubrimiento y persistencia. Un toast dice
"Brave Search conectado: 2 herramientas descubiertas" o el aviso de qué falta.
Si ya estaba instalado, 409. Ver [[Tienda MCP]].

## 3. Asignar

La tienda **no le da las herramientas a nadie**. En la pestaña **MCP**, la matriz
"Quién usa qué": un clic en la celda de cada investigador y la columna `brave`.
El guardado del rol llama a `Runtime.actualizarRolEnCorridasVivas`, que
incorpora las tools al catálogo de la corrida viva **antes** de otorgarlas y deja
un log "recibe 2 herramienta(s) desde la configuración".

## 4. Verificar

- **Probador** del Hub: `mcp__brave__brave_web_search` con `{"query": "…"}`.
- En la corrida, `tool.selection` del próximo turno del investigador tiene que
  listar las de `brave`; después, `tool.start`/`tool.end` y el contador de
  invocaciones del Hub.

## Lo que pasa con dos investigadores a la vez

Brave en plan Free acepta una consulta por segundo. La fila del servidor
serializa las dos búsquedas y, si la segunda recibe un 429, espera 1,1 s (o lo
que diga `retry-after`) **dentro de la fila** y reintenta hasta dos veces. Si el
límite es la cuota del mes, el error llega al agente después del segundo
reintento. Ver [[Integración MCP]].

## Qué puede salir mal

| Síntoma | Causa |
|---|---|
| "conectado: 0 herramientas" o `reconnecting` | el paquete no bajó, `npx` no está en el `PATH`, o la credencial falta y el servidor muere al arrancar |
| sigue diciendo "falta" después de editar `.env` | no se reinició el servidor |
| instalado, asignado y el agente sigue con `web_search` | la corrida es anterior a la asignación y se asignó por un camino que no llega a las corridas vivas (aprobar un `request_tool_access`); reasigná desde el rol o arrancá otra corrida |
| el agente no lo elige | la tarea no dice "buscar": el router puntúa por palabras. Mencionalo en el objetivo o sacale otras opcionales al rol |

## Enlaces

- [[Tienda MCP]] · [[Referencia de la tienda MCP]] · [[Integración MCP]]
- [[CU-05 Conectar un servidor MCP]] · [[Pantalla Tienda]]
