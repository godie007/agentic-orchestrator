---
tags: [arquitectura, pantalla]
aliases: [Tienda.tsx, Tienda de servidores MCP, Marketplace MCP, IconoDe]
---

# Pantalla Tienda

**Ruta:** `/p/:companyId/tienda`. **Componente:**
`apps/web/src/routes/Tienda.tsx` → `Tienda`.

El catálogo curado de servidores MCP (`CATALOGO_MCP`, en el repo) dispuesto como
marketplace: por categoría, con búsqueda, las credenciales requeridas a la vista e
instalación de un click. Instalar hace el ciclo entero del lado del servidor
—alta, handshake, descubrimiento— y la pantalla cuenta el resultado con un toast.
Lo que no está en el catálogo se agrega pegando su JSON en
[[Pantalla Hub MCP]]. El catálogo y sus reglas: [[Tienda MCP]] y
[[Referencia de la tienda MCP]].

## Datos

`["tienda-mcp", companyId]` → `GET /api/tienda-mcp?companyId=…`: cada artículo del
catálogo (`id`, `nombre`, `descripcion`, `categoria`, `icono`, `servidor`,
`envRequeridas`, `docsUrl`) más dos campos calculados para este proyecto:

- `instalado`: ya hay un servidor con ese `catalogoId` o con el mismo nombre;
- `envFaltantes`: las variables **obligatorias** sin valor en el entorno del
  servidor. Así una credencial faltante se dice **antes de instalar**, no en un
  handshake fallido de después.

Hoy son 25 artículos en 8 categorías.

## La pantalla

Un párrafo que resume las reglas: cada servidor le suma herramientas al proyecto,
instalar conecta y descubre al toque, las credenciales van en el `.env` del
servidor —acá nunca se pega un secreto— y lo que no está se agrega en MCP.

**Buscar** (arriba a la derecha) filtra por nombre, descripción o id de categoría
(`web`, `datos`…, no el rótulo). Los artículos se agrupan por categoría:

| Id | Rótulo |
|---|---|
| `archivos` | Archivos |
| `desarrollo` | Desarrollo |
| `web` | Web y búsqueda |
| `datos` | Datos |
| `productividad` | Productividad |
| `navegador` | Navegador |
| `comunicacion` | Comunicación |
| `conocimiento` | Conocimiento |

Cada tarjeta:

- el ícono (`IconoDe`: el nombre kebab-case del catálogo pasado a PascalCase y
  buscado en Lucide; si no existe, una lupa), el nombre y **documentación ↗**;
- "instalado" con un check, si ya está;
- la descripción;
- una etiqueta por variable requerida (`KeyRound` + nombre, con su descripción en
  el `title`): verde, o amarilla con "· falta"; sin variables, "sin credenciales";
- **instalar**, si no está instalado. Con variables faltantes el `title` avisa
  "Se instala igual, pero sin X no va a autenticar."

Cargando: seis esqueletos. Sin coincidencias: "Nada coincide con «…»".

## Instalar

**instalar** → `POST /api/companies/:id/tienda-mcp/:articuloId` →
`Runtime.instalarServidoresMcp`: deduplica, chequea el entorno, da de alta,
sincroniza **esperando el handshake** y descubre las herramientas. Mientras tanto
el botón dice "conectando…" (y los demás quedan deshabilitados: hay una sola
instalación a la vez).

- Éxito: toast "<nombre> conectado: N herramientas descubiertas."; cada aviso
  (por ejemplo, la credencial que falta) llega como un toast de error aparte.
- Ya instalado: 409 "… ya está instalado en este proyecto." como toast de error.
- Se invalidan `company`, `mcp-health`, `tools` y `tienda-mcp`.

> [!warning] Instalar no le da las herramientas a nadie
> La tienda instala **sin otorgar**: después hay que asignarlas, en la matriz
> "Quién usa qué" del Hub o en el editor de roles. Se midió con Brave: instalado,
> conectado y `ready`, con cero invocaciones, mientras una corrida insistía con
> una búsqueda que su proveedor no soportaba. Ver
> [[CU-10 Instalar un servidor desde la tienda]].

## Casos borde

> [!note] Cinco artículos se dibujan con la lupa
> Lucide 1.31 ya no trae íconos de marca: `github`, `gitlab`, `youtube`, `chrome`
> y `slack` no existen, así que GitHub, GitLab, YouTube transcript, Puppeteer y
> Slack caen en el ícono genérico. El test del catálogo valida el esquema, no el
> ícono.

- Una variable **opcional** que no está en el entorno se pinta en verde, igual que
  una presente: sólo las obligatorias cuentan como faltantes.
- Si el catálogo no se pudo pedir, la pantalla dice "Nada coincide con «»" en vez
  de mostrar el error.
- Los `mcpSugeridos` de una plantilla de equipo no se instalan solos: llegan como
  toast al crear el proyecto ([[Pantalla Proyectos]]) y se instalan desde acá.

## Qué fijan los tests

`packages/shared/src/tienda-mcp.test.ts`: todas las entradas validan contra el
esquema; ids y nombres de servidor no se repiten; ningún `env` del transporte
lleva un valor con pinta de secreto; toda variable del transporte está declarada
en `envRequeridas`; el catálogo tiene más de una categoría; `articuloDeTienda`
devuelve `null` para lo desconocido.

## Fuentes

- `apps/web/src/routes/Tienda.tsx` — `Tienda`, `IconoDe`, `CATEGORIA`.
- `apps/web/src/api.ts` — `tiendaMcp`, `instalarDeTienda`,
  `ArticuloDeTiendaConEstado`, `ResultadoInstalacionMcp`.
- `apps/server/src/routes.ts` — `GET /api/tienda-mcp`,
  `POST /api/companies/:id/tienda-mcp/:articuloId`.
- `packages/shared/src/tienda-mcp.ts` — `CATALOGO_MCP`, `articuloDeTiendaSchema`.

## Ver también

- [[Tienda MCP]]
- [[Referencia de la tienda MCP]]
- [[Cómo agregar un servidor a la tienda MCP]]
- [[Pantalla Hub MCP]]
