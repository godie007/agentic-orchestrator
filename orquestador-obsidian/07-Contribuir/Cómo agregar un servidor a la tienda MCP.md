---
tags: [contribuir, mcp]
aliases: [agregar artículo a la tienda, nuevo servidor en CATALOGO_MCP]
---

# Cómo agregar un servidor a la tienda MCP

La tienda es una lista curada en el repo (`CATALOGO_MCP`,
`packages/shared/src/tienda-mcp.ts`), no un registro remoto: sumar un servidor es
agregar un objeto y correr los tests. Cómo funciona la instalación:
[[Tienda MCP]].

## Cuándo vale la pena

Cuando un servidor ya se pegó a mano en más de un proyecto, o una plantilla de
equipo lo necesita. Lo que usa un solo proyecto se queda en el Hub
([[CU-05 Conectar un servidor MCP]]).

## 1. Probalo pegándolo

Antes de tocar el catálogo, dalo de alta en un proyecto de prueba con su JSON,
mirá que llegue a `ready`, cuántas herramientas trae, y ejecutá una con el
probador del Hub. Si se conecta ahí, el artículo va a conectar igual.

## 2. Escribí el artículo

```ts
{
  id: "mi-servidor",                      // único; va en la URL y en catalogoId
  nombre: "Mi Servidor",
  descripcion: "Qué le suma a un agente, en una o dos frases.",
  categoria: "web",                       // una de las 8 de categoriaDeTiendaSchema
  icono: "globe",                         // Lucide, kebab-case
  servidor: {
    name: "miservidor",                   // ^[a-z0-9_-]+$ — prefijo de sus tools
    description: "Para qué sirve.",
    transport: stdio("npx", ["-y", "paquete-mcp"], { MI_API_KEY: "MI_API_KEY" }),
  },
  envRequeridas: [
    { ref: "MI_API_KEY", descripcion: "API key de …", obligatoria: true },
  ],
  docsUrl: "https://github.com/…",
}
```

Reglas que el test hace cumplir:

- `id` y `servidor.name` **no se repiten** en el catálogo. Elegí el `name` con
  cuidado: es el prefijo `mcp__<name>__` de todas sus herramientas y lo que la
  tienda usa para decir "instalado" (también cuenta un servidor pegado a mano con
  ese nombre).
- Los valores de `envRefs`/`headerRefs` son **nombres de variables**, nunca
  valores: se validan con el mismo `referenciaDe` que descarta secretos al
  importar.
- Toda variable del transporte está en `envRequeridas`. Es lo que permite decir
  "falta X" **al instalar** y no en un handshake fallido de después.
- El artículo valida contra `articuloDeTiendaSchema` (`docsUrl` es una URL, largos
  máximos, categoría del enum).

Criterios que no chequea un test:

- **Comando del README** (`npx -y …`, `uvx …`), fijando versión sólo si el
  `@latest` se rompe seguido.
- **Rutas relativas** (`.`, `data/…`) se resuelven contra el directorio de
  trabajo del servidor del orquestador: decilo en la descripción.
- `obligatoria: false` para las variables sin las que el servidor igual sirve.
- Si expone operaciones con plata o irreversibles, decilo en la descripción: la
  tienda instala con `autoApproveTools: true`.
- Un servidor HTTP remoto con OAuth va con `type: "http"` y `headerRefs: {}`; el
  flujo de autorización ya existe ([[OAuth para servidores MCP]]).

## 3. Si una plantilla lo sugiere

Agregá el `id` a `mcpSugeridos` de la plantilla en
`packages/shared/src/plantillas.ts`. `plantillas.test.ts` exige que cada sugerido
exista en la tienda. No se instala solo: la UI lo sugiere al crear el proyecto.

## 4. Verificá

```bash
npx vitest run packages/shared/src/tienda-mcp.test.ts packages/shared/src/plantillas.test.ts
npm run typecheck
```

Y abrí la pestaña **Tienda**: el ícono se resuelve por nombre en Lucide; uno que
no existe cae en la lupa sin romper nada.

## 5. Documentalo

Una fila en [[Referencia de la tienda MCP]] en su categoría, con sus variables y
lo que no sea obvio.

## Lista de control

- [ ] probado pegando el JSON: `ready` y una tool ejecutada
- [ ] `id` y `servidor.name` únicos
- [ ] variables por nombre y todas declaradas en `envRequeridas`
- [ ] ícono de Lucide y `docsUrl`
- [ ] tests de la tienda y de plantillas en verde
- [ ] fila en la referencia

## Ver también

- [[Tienda MCP]] · [[Integración MCP]] · [[Cómo agregar una herramienta]]
