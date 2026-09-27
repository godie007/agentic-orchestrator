---
tags: [capacidad, plataforma, mcp, seguridad]
aliases: [OAuth MCP, mcp-oauth.ts, crearFabricaOAuth, olvidarOAuth, ProveedorEnArchivo, completarAutorizacion, Autorizar]
---

# OAuth para servidores MCP

Algunos servidores MCP remotos (el de Supabase, el de Sentry) no aceptan una
API key en una cabecera: piden que una persona **inicie sesión** en el navegador,
como `claude mcp add --transport http`. El orquestador lo resuelve igual: el Hub
ofrece **Autorizar**, la persona entra al servicio, la vuelta llega al servidor
del orquestador y los tokens quedan guardados fuera de la base y se renuevan
solos.

## Cuándo se usa

Sólo en transporte `http` **sin cabeceras de credencial** declaradas
(`headerRefs` vacío). `McpBridge.buildTransport` le pide entonces a la
`FabricaOAuth` inyectada un proveedor y se lo pasa al transporte como
`authProvider`; si el servidor no pide autorización, el proveedor nunca se usa.
Un transporte con `headerRefs` va por cabecera y no recibe OAuth.

## El flujo

```mermaid
sequenceDiagram
  participant BR as McpBridge
  participant PR as ProveedorEnArchivo
  participant SV as Servidor MCP remoto
  participant HUB as Hub (persona)
  participant CB as /api/mcp/oauth/callback
  BR->>SV: connect (HTTP)
  SV-->>BR: 401: hay que autorizar
  BR->>PR: registro dinámico, verificador PKCE, state
  PR->>BR: redirectToAuthorization(url) → health.autorizacion = url
  BR->>HUB: status "error", "Falta autorizar el acceso" (sin reintento)
  HUB->>SV: la persona abre "Autorizar" e inicia sesión
  SV->>CB: redirect ?code=…&state=…
  CB->>BR: completarAutorizacion(state, code)
  BR->>PR: transporte.finishAuth(code) → saveTokens
  BR->>SV: connect de nuevo, con token
  SV-->>BR: ready + tools
  BR->>HUB: SSE "ready"; otorgarAlConectar
```

1. El SDK hace el descubrimiento, el **registro dinámico** del cliente
   (`saveClientInformation`) y PKCE (`saveCodeVerifier`), y llama a
   `redirectToAuthorization(url)`. Desde el servidor no hay navegador que abrir:
   la URL va a `health.autorizacion`.
2. `open` ve `UnauthorizedError` (o la autorización pendiente) y deja el servidor
   en `error` con "Falta autorizar el acceso: abrí el enlace de autorización e
   iniciá sesión." **No reintenta**: el servidor va a decir que no hasta que
   alguien inicie sesión, y reintentar sólo gastaría pedidos.
3. El Hub dibuja **Autorizar** (un enlace a esa URL en otra pestaña).
4. El proveedor redirige a `${API_URL}/api/mcp/oauth/callback?code&state`.
5. La ruta llama a `Runtime.completarAutorizacionMcp(state, code)`, que recorre
   los runtimes de todas las empresas; `McpBridge.completarAutorizacion` busca la
   conexión cuya URL de autorización lleva **ese** `state`, canjea el código
   **en el mismo transporte** que pidió la autorización (`finishAuth`), limpia la
   autorización, pasa a `connecting` y vuelve a abrir.
6. Al quedar `ready`, se persisten las tools y se otorgan a los roles anotados en
   `otorgarAlConectar` —también en las corridas vivas— y la lista se vacía.
7. La ruta contesta una **página**, no JSON (la abre la persona): "Listo: X está
   autorizado", "No se autorizó" (con el `error_description` escapado), "Falta
   información" o "No encontré ese pedido". Se cierra sola a los 2,5 s.

Los tokens se renuevan solos con el `refresh_token` (lo maneja el SDK).

## Dónde van los tokens

`apps/server/src/mcp-oauth.ts` → `crearFabricaOAuth(directorio, vuelta)` y la
clase `ProveedorEnArchivo`, que implementa `OAuthClientProvider` del SDK.

- **Nunca a la base**: la misma regla que los secretos por referencia. Una
  empresa exportada a JSON no puede llevarse una credencial adentro.
- Un archivo por servidor: `<dirname(DATABASE_URL)>/mcp-oauth/<serverId>.json`
  —con la configuración por defecto, `data/mcp-oauth/`—. El directorio se crea
  con permisos `0700` y el archivo se escribe con `0600`. El id se sanea a
  `[a-z0-9_-]`.
- Contenido: `cliente` (la registración dinámica), `tokens` y, mientras dura un
  pedido, `verificador` (PKCE). Al guardar los tokens el verificador se borra: es
  de un solo pedido.
- `clientMetadata`: `client_name: "Orquestador Agéntico"`, `redirect_uris` = la
  URL de vuelta, `grant_types` `authorization_code` y `refresh_token`,
  `token_endpoint_auth_method: "none"` (cliente público con PKCE).
- `state()` es aleatorio (16 bytes en hex), uno por instancia de proveedor: es lo
  que ata la vuelta del navegador a este servidor.
- `invalidateCredentials(all|client|tokens|verifier|discovery)` borra lo pedido.
- **Borrar el servidor borra su archivo** (`olvidarOAuth`, dentro de
  `Runtime.eliminarServidorMcp`).

## Quién recibe las herramientas

Como las tools recién aparecen al autorizar, un servidor con OAuth no puede
otorgarlas en el alta. Para eso está `McpServer.otorgarAlConectar`: los ids de
rol que las reciben al conectar (`Runtime.otorgarAlConectar`).

> [!warning] Hoy sólo por la API
> El alta del Hub manda `otorgarAlConectar: []` y ni la tienda ni la aprobación
> de `solicitar_servidor_mcp` lo llenan. Para usarlo hay que dar de alta o editar
> el servidor por `POST`/`PATCH /api/companies/:companyId/mcp-servers`. Sin eso,
> después de autorizar hay que asignar las herramientas a mano (matriz del Hub).

## Casos borde

| Síntoma | Causa |
|---|---|
| "No encontré ese pedido" en la vuelta | el servidor del orquestador se reinició, o alguien apretó "reconectar" (cada conexión crea un proveedor con un `state` nuevo y el enlace viejo deja de valer). Volvé a apretar Autorizar |
| el navegador no vuelve al orquestador | `API_URL` no es una dirección que el navegador de la persona alcance |
| autorizó y quedó `ready`, pero nadie tiene las tools | `otorgarAlConectar` vacío: asignalas |
| una reconexión extra justo después de autorizar | `otorgarAlConectar` se vació y la fila cambió: el próximo `sync` reconecta (con el token guardado, sin volver a pedir) |
| el servidor pide autorizar de nuevo | se revocó el refresh token o se borró el archivo |

## Seguridad

- `state` de 128 bits por pedido; la vuelta sin `code` o sin `state` no hace nada.
- La página de vuelta escapa lo que devuelve el proveedor antes de mostrarlo.
- Los tokens quedan en disco legibles sólo por el usuario del proceso, fuera de
  la base, del blueprint y de la bóveda versionada.

## Qué fijan los tests

`apps/server/src/mcp-oauth.test.ts`:

- guarda cliente y tokens en un archivo `0600`, la `redirect_uri` es la vuelta
  configurada, el pedido de autorización llega a `alPedir`, el verificador se
  borra con los tokens, y una segunda instancia recupera cliente y tokens con un
  `state` distinto;
- invalidar tokens conserva el cliente, y `olvidarOAuth` borra el archivo.

El flujo completo (`completarAutorizacion`, la ruta de vuelta) no tiene test.

## Fuentes

- `apps/server/src/mcp-oauth.ts` → `crearFabricaOAuth`, `ProveedorEnArchivo`, `olvidarOAuth`
- `packages/tools/src/mcp/bridge.ts` → `FabricaOAuth`, `buildTransport`, `open`, `completarAutorizacion`
- `apps/server/src/runtime.ts` → `fabricaOAuth`, `dirOAuth`, `completarAutorizacionMcp`, `otorgarAlConectar`, `eliminarServidorMcp`
- `apps/server/src/routes.ts` → `GET /api/mcp/oauth/callback`
- `apps/web/src/routes/McpHub.tsx` → botón Autorizar

## Ver también

- [[Integración MCP]] · [[CU-05 Conectar un servidor MCP]] · [[Seguridad]]
