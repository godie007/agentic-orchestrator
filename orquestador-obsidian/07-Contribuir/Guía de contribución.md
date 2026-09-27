---
tags: [contribuir]
aliases: [Contribuir, Cómo trabajar en esto]
---

# Guía de contribución

## Antes de escribir una línea

Leé, en este orden:

1. [[Invariantes de arquitectura]] — las reglas que no se rompen, dónde viven y qué test las fija
2. [[Trampas conocidas]] — lo que ya costó caro, por área
3. [[Decisiones de arquitectura]] — por qué está hecho así y qué se resignó
4. La nota de arquitectura o capacidad del área que vas a tocar ([[Mapa del monorepo]] dice qué archivo es de qué)

## Idioma

**Español rioplatense** en el código, los comentarios y la UI. Un comentario en
inglés desentona con todo lo que lo rodea. Dos excepciones deliberadas:

- las **instrucciones largas para agentes** (prompts de plantillas, guía del kit
  de láminas) van en inglés porque el modelo las sigue con más precisión, y
  **cada una declara arriba que la salida es castellano** (lo fija
  `plantillas.test.ts`);
- los **contratos de terceros** conservan sus nombres (`to`, `subject` del
  webhook de n8n).

Los comentarios explican **por qué**, no qué. La mayoría de los comentarios
largos del repo son el registro de algo que costó caro, con la medición: seguí
esa forma ("lo pagamos con…", "medido: …").

## Calidad

```bash
npm run typecheck && npm test
```

- **No hay linter** ni hook: `typecheck` es la puerta (`strict`,
  `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `noImplicitOverride`,
  `noFallthroughCasesInSwitch`).
- Un archivo o un caso: `npx vitest run <archivo>` o `npx vitest run -t "<nombre>"`.
- Los tests del motor corren con `FakeProvider` y sin disco; los del servidor con
  `construirApp` y `app.inject` (`apps/server/src/testing/entorno.ts`).
  `vitest.config.ts` excluye `data/` y pone `ORQ_ESPERA_PROVEEDOR_MS=0`.
- Ver [[Pruebas y calidad]].

> [!warning] `npm run dev` reinicia el servidor con cada cambio
> `tsx watch` recarga al tocar cualquier archivo que el servidor importa,
> `packages/` incluidos, y un reinicio **mata las corridas en memoria**. Antes de
> editar el motor o el servidor, fijate que no haya una corrida andando, o
> corré el servidor sin `watch`.

## Cuándo hace falta un test

Siempre que arregles un comportamiento. Los tests del repo no son cobertura
genérica: **cada uno vigila algo que ya pasó**, y el nombre del caso lo cuenta
en castellano ("no informa éxito cuando nadie produjo nada").

- Si el bug era de concurrencia, el test lo reproduce con concurrencia (el de
  atribución usa 4 agentes en paralelo).
- Si la regla es de seguridad y vive en un `spawn`, **exportá la función que
  arma los argumentos** para poder fijarla (`construirArgs`, `perfilSandbox`,
  `configDelTurno`).
- Si un número sale de una medición, el test fija el comportamiento, no el
  número exacto, salvo que sea contrato (topes acoplados).

## Reglas de estructura

| Regla | Por qué |
|---|---|
| Un campo nuevo entra **primero** en `packages/shared/src/schema.ts`, con `.default()` si hay filas viejas | ambos lados infieren de ahí; las filas viejas tienen que parsear |
| Un paso nuevo **emite un evento** ([[Cómo agregar un evento]]) | un paso sin evento es invisible |
| `packages/engine` **no importa** Fastify ni SQLite | los tests corren sin tokens ni disco |
| Los `packages/` **no se compilan** | sin build step que mantener |
| Una regla que usan dos lados vive **una vez** en `@orq/shared` | dos copias divergen |
| Toda llamada de red o proceso externo **lleva corte por tiempo** | un endpoint mudo cuelga la corrida |
| Los secretos van **por referencia**, nunca en la base ni en un blueprint | una empresa exportada no lleva credenciales |
| El freno de una herramienta va **en su `execute`**, no en su descripción | un agente ignora instrucciones, no al ejecutor |
| Toda ruta que propone un modelo pasa por el saneo | un modelo no escribe fuera de su directorio |
| Una herramienta que no se puede cumplir **no se registra** | hace gastar turnos |
| Un rechazo **dice qué hacer** (a quién escalar, qué claves existen) | el resultado es lo único que el agente lee |

## Cuándo hace falta un ADR

Cuando la decisión cierra una puerta (descarta una alternativa razonable), tiene
un costo que alguien va a querer revisar, o contradice lo obvio. Plantilla e
índice en [[Decisiones de arquitectura]]. Si revisa uno anterior, actualizá el
**Estado** del viejo apuntando al nuevo.

## Cuándo actualizar esta bóveda

| Cambiaste… | Actualizá |
|---|---|
| `schema.ts` | [[Modelo de dominio]] y [[Referencia de esquemas]] |
| `events.ts` | [[Referencia de eventos]] y [[Observabilidad y trazas]] |
| `routes.ts` / `rutas-codigo.ts` | [[Referencia de API]] / [[Referencia de API de código y móvil]] |
| una herramienta | [[Catálogo de herramientas]] y [[Referencia de herramientas]] |
| una habilidad | [[Habilidades de producción]] ([[Cómo agregar una habilidad]]) |
| una plantilla | [[Referencia de plantillas de equipo]] ([[Cómo agregar una plantilla de equipo]]) |
| la tienda MCP | [[Referencia de la tienda MCP]] ([[Cómo agregar un servidor a la tienda MCP]]) |
| un proveedor LLM | [[Capa LLM y tiers]] ([[Cómo agregar un proveedor LLM]]) |
| una variable de entorno | [[Variables de entorno]] y `.env.example` |
| un bug caro | [[Trampas conocidas]] y [[Diagnóstico de problemas]] |
| una regla que no se puede romper | [[Invariantes de arquitectura]] |
| una decisión de diseño | un ADR nuevo |

Las convenciones de escritura están en [[Convenciones de documentación]]:
nombre de archivo = título, frontmatter, línea en blanco antes de cada
encabezado, anclaje `archivo → símbolo`, cero secretos.

## Los tres lugares de documentación

| Lugar | Para quién |
|---|---|
| `README.md` | quien evalúa el producto |
| `CLAUDE.md` | agentes de código que trabajan sobre el repo: invariantes e incidentes |
| `orquestador-obsidian/` | esta bóveda: producto, arquitectura, operación, referencia |

Cuando haya conflicto, **manda el código**, y se corrige el texto.

## Git

- No trabajes sobre `main`: una rama por cambio.
- Mensajes en español, con el **por qué** cuando no es obvio
  (`fix(móvil): esperar_texto se cuenta con el reloj, no en vueltas`).
- `npm run typecheck && npm test` antes de commitear.

## Cómo agregar cosas

- [[Cómo agregar un proveedor LLM]]
- [[Cómo agregar una herramienta]]
- [[Cómo agregar una habilidad]]
- [[Cómo agregar un evento]]
- [[Cómo agregar una plantilla de equipo]]
- [[Cómo agregar un servidor a la tienda MCP]]

## Lo que NO hay que hacer

- Agregar un paso de build a un `package/`.
- "Arreglar" el aviso de `npm audit` sin leer `package.json` → `auditNotes`.
- Introducir estado mutable por turno en `RunState`.
- Presentar las herramientas de coordinación como si se pudieran quitar.
- Poner un reloj adentro del motor o del render.
- Usar `cheap` para un rol que coordina, o `free` para uno que verifica.
- Darle `Bash` o `Write` al CLI de un proveedor que delega.
- Memoizar lecturas **entre** turnos.
- Mover uno de los topes acoplados (`TOPE_RESULTADO`, `TOPE_ENTERO`,
  `LINEAS_POR_LECTURA`) sin mirar los otros.
- Editar el servidor con una corrida viva y `npm run dev` andando.

## Ver también

- [[Invariantes de arquitectura]] · [[Trampas conocidas]] · [[Decisiones de arquitectura]]
- [[Pruebas y calidad]] · [[Comandos]] · [[Convenciones de documentación]]
