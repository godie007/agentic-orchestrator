---
tags: [capacidad, organización]
aliases: [Árbol de contexto, ContextoStore, leer_contexto, buscar_contexto, escribir_contexto, mapaDeContextoEnPrompt, notaDeAprendizajes, CONTEXTO_DIR, vault-contexto.ts]
---

# Vault de contexto

Cada empresa tiene un **árbol de contexto** escrito como un vault de Obsidian:
una carpeta con notas markdown donde vive lo **largo** que la empresa sabe
—dossiers, mapas de pantalla, decisiones con su porqué— y el espejo legible de
su memoria. No es esta bóveda de documentación: es el vault que escriben y leen
los agentes de cada proyecto, en `CONTEXTO_DIR` (default `./data/contexto`), una
rama por empresa.

## Por qué existe: la aritmética

Una llamada a herramienta dentro de un turno delegado cuesta **una iteración
entera**, o sea 20.000 a 28.000 tokens de prefijo reenviado. Por debajo de unos
**800 caracteres** sale más barato **mandar** que ir a buscar; por encima, al
revés. Por eso:

- La memoria corta (una lección de un párrafo) viaja en el prompt de cada turno
  ([[Memoria de la empresa]]).
- Lo largo vive acá, y al prompt viaja sólo el **mapa**: título y tamaño de
  cada nota. Medido en la empresa del video: **465 tokens de mapa apuntan a
  59.743 caracteres de conocimiento — 32 a 1**.

Y hacía falta porque la memoria del prompt está topeada: en la empresa que lo
disparó había 58 lecciones y entraban unas diez. Las otras 48 existían sin que
ningún agente pudiera verlas ni pedirlas.

## Por qué por el filesystem y no por el plugin de Obsidian

Un vault es una carpeta con markdown: escribirlo por el filesystem evita una
segunda instancia de Obsidian, un segundo puerto y un segundo token, y sobre
todo evita que el contexto **dependa de que una aplicación de escritorio esté
abierta**, que ya falló media tarde (el servidor MCP de Obsidian estuvo caído).
Es la regla de ffmpeg, Kokoro y Chrome: usar lo que hay y degradar con aviso.
Obsidian queda como visor y editor: el grafo, la búsqueda y poder **corregir a
mano**.

## Las herramientas

`packages/tools/src/contexto.ts` → `crearHerramientasDeContexto(storage)`. Son
`origin: "coordination"` (todos los roles las tienen) y se registran **por
empresa** en `Runtime.companyRuntime`: `packages/tools` no decide dónde vive el
vault, lo inyecta el servidor (`ContextoStorage`). El nombre de la empresa se
resuelve al usar, así un renombre no exige reiniciar el runtime.

| Herramienta | Argumentos | Qué hace |
|---|---|---|
| `leer_contexto` | `ruta` | Abre una nota: "📗 *ruta*" y el contenido. Si no existe: "Mirá el mapa que tenés en el prompt… o buscá con buscar_contexto" |
| `buscar_contexto` | `texto` | Devuelve **dónde** aparece: `- ruta → línea`, no el contenido. Sin resultados, sugiere guardarlo con `escribir_contexto` si lo averigua |
| `escribir_contexto` | `ruta`, `contenido` | Crea o **reemplaza** la nota entera. Menos de 40 caracteres: "no es una nota: usá record_lesson". Respuesta: "Aparece en el mapa de contexto del próximo turno de todos" |

`buscar_contexto` devuelve ubicaciones por la misma razón que todo lo demás: lo
que entra a un turno delegado se reenvía en cada vuelta. `escribir_contexto`
reemplaza la nota entera, así que **quien escribe último decide**; lo que edita
una persona se lee tal cual hasta que un agente lo reescriba.

## El mapa en el prompt

`mapaDeContextoEnPrompt` arma la sección "## Lo que la empresa tiene
documentado", con `` - `ruta` — título (N car.) `` por nota. La inyecta el
orquestador **en cada turno** (`mapaDeContexto` en las dependencias de
`Orchestrator`, resuelto por turno en `Runtime.startRun`): una nota escrita en
un ciclo la ven todos en el siguiente. Un árbol vacío no ocupa lugar.

## `ContextoStore` por dentro

`apps/server/src/contexto.ts`:

- **Carpeta por nombre legible** (`segmentoLegible(nombre)`), con un archivo
  oculto `.empresa` que guarda el id. Si esa carpeta es de otra empresa
  homónima, prueba `Nombre (últimos 6 del id)`. Una carpeta sin marca se
  reclama **sólo al escribir**: consultar no crea nada (`resolverDir(…, crear)`).
- **Rutas saneadas** (`destino`): parte por `/` o `\`, descarta vacíos, `.` y
  `..`, pasa cada segmento por `segmentoLegible`, se queda con **los primeros 4
  segmentos**, fuerza `.md` en el último y exige que el resultado quede dentro
  de la carpeta. El `.md` se fuerza porque un `.txt` no se indexa, no entra al
  grafo y rompe los `[[…]]`.
- **`mapa`**: recorre la carpeta ignorando lo que empieza con punto
  (`.obsidian/`), sólo `.md`, ordena por modificación (lo más nuevo primero) y
  corta en **60 notas** o **4.000 caracteres** de ruta más título, lo que llegue
  antes. Se acota por tamaño y no sólo por cantidad: la misma lección que dejó
  la memoria.
- **`buscar`**: sin mayúsculas, primera línea que contiene el texto, recortada a
  200 caracteres.
- **`renombrar`**: al renombrar la empresa mueve la carpeta (si el destino es de
  otro, no mezcla vaults). Sin esto el proyecto renombrado abría un vault vacío
  al lado del que tenía la memoria.
- **`borrar`**: lo usa el espejo cuando un tema se queda sin lecciones. Los
  agentes no tienen herramienta para borrar.

| Constante | Valor | Por qué |
|---|---|---|
| `TOPE_MAPA` | 60 notas | Un árbol de mil notas no se navega desde un prompt |
| `TOPE_MAPA_CARACTERES` | 4.000 | Sesenta títulos largos son un bloque que se reenvía en cada vuelta |
| Mínimo de una nota | 40 caracteres | Una línea es una lección, no una nota |
| Profundidad de ruta | 4 segmentos | Saneo |

## El espejo de la memoria

Cada cambio de memoria reescribe `Aprendizajes/<Título del tema>.md`
(`Runtime.espejarAprendizajes` con `rutaDeTema`), y un tema sin lecciones se
**borra**. `notaDeAprendizajes` arma una nota legible **desde Obsidian**, no
sólo desde un `cat`:

1. **Frontmatter** con `empresa`, `tema`, `lecciones`, `actualizada` y `tags`
   (`orquestador/aprendizaje`, `orquestador/<tema>`): Obsidian lo muestra como
   propiedades y lo hace filtrable.
2. `# Título` (`tituloDeTema`: `:` y `_` pasan a " — ", `-` a espacio, siglas
   como `QA`, `PDF`, `MCP`, `IA` en mayúscula).
3. Un aviso honesto: la nota se regenera sola y lo editado a mano se pierde; se
   corrige desde la pantalla Memoria.
4. `← [[00 - Índice|Índice del vault]]` y "## Relacionadas": las notas de la
   misma **familia** (primera palabra del tema: `inspia:escena-8` encuentra a
   `inspia:escena-9`). Sin `[[…]]` el grafo es una estrella desde el índice:
   medido al arreglarlo, de 20 enlaces a 258 y de 0 notas con propiedades a 24.
5. Una sección `##` por lección viva (encabezado de hasta 62 caracteres),
   ordenadas por confirmaciones, con "(sin verificar)" si está cuestionada, la
   evidencia y "reafirmada N veces".
6. "## Refutadas": cada una tachada con su motivo. Se conservan: son memoria de
   errores.

Siempre con **línea en blanco antes de cada `##`**: sin ella markdown no lo toma
como encabezado y la nota sale como texto plano.

## El volcado inicial

`npx tsx scripts/vault-contexto.ts <companyId>` lee la base en sólo lectura,
escribe una nota por tema con el mismo `notaDeAprendizajes` (así la memoria
migrada y la aprendida trabajando salen iguales) y la portada `00 - Índice` con
la misión y la lista de notas. No hay script de npm para esto.

## Casos borde y fallas

> [!danger] El título de una nota con frontmatter sale como `---`
> `primeraLinea` toma la primera línea no vacía sin `#`, y en una nota con
> frontmatter esa línea es `---`. Resultado: en el mapa del prompt todas las
> notas de `Aprendizajes/` aparecen como `— ---`, y en el índice que escribe el
> script los enlaces quedan con alias **vacío** (`[[Aprendizajes/Rodaje|]]`).
> Verificado en el vault real de una empresa.

| Síntoma | Causa |
|---|---|
| `buscar_contexto` no encuentra una nota que existe | La búsqueda recorre sólo las notas que entran en el **mapa** (60 / 4.000 caracteres, las más recientes). Las viejas se abren con `leer_contexto` si se sabe la ruta |
| Una ruta profunda quedó más corta | Se conservan los primeros 4 segmentos |
| El enlace al índice no lleva a nada | `00 - Índice` sólo lo escribe el script de volcado |
| Una lección nacida de una consulta no aparece en el vault | `notifyRequester` la guarda sin espejar (ver [[Memoria de la empresa]]); la respuesta larga sí queda en `Consultas/` |
| Borré la empresa y el vault sigue | `Runtime.eliminarEmpresa` no toca `CONTEXTO_DIR` |
| Edité a mano una nota de `Aprendizajes/` y se perdió | Se regenera con cada cambio del tema; se corrige desde la pantalla Memoria |

## Qué fijan los tests

- `packages/tools/src/contexto.test.ts` → abre la nota del mapa; si no existe manda al mapa; buscar devuelve dónde mirar; sin resultados invita a guardar; escribir avisa que aparece en el mapa; una línea suelta va a `record_lesson`; propaga el motivo del almacén; el mapa lista rutas y títulos, nunca contenido; un árbol vacío no ocupa lugar.
- `apps/server/src/contexto.test.ts` → escribe y lee tal cual; fuerza `.md`; lo inexistente es `null`; reemplaza entera; descarta `..`; rechaza la ruta vacía; cada empresa en su rama; el mapa no trae contenido, tolera el vault inexistente e ignora `.obsidian`; nombres legibles; homónimas no comparten; consultar no crea; `notaDeAprendizajes` con frontmatter, línea en blanco antes de `##`, enlaces al índice y a la familia.

## Fuentes

- `packages/tools/src/contexto.ts` → `crearHerramientasDeContexto`, `ContextoStorage`, `mapaDeContextoEnPrompt`
- `apps/server/src/contexto.ts` → `ContextoStore` (`resolverDir`, `destino`, `escribir`, `leer`, `borrar`, `mapa`, `buscar`, `renombrar`), `notaDeAprendizajes`, `tituloDeTema`, `rutaDeTema`, `primeraLinea`, `TOPE_MAPA`, `TOPE_MAPA_CARACTERES`
- `apps/server/src/runtime.ts` → `companyRuntime`, `espejarAprendizajes`, `startRun` (`mapaDeContexto`), `renombrarEmpresa`
- `packages/shared/src/nombres.ts` → `segmentoLegible`
- `scripts/vault-contexto.ts`

## Ver también

- [[Memoria de la empresa]]
- [[Turnos delegados a un CLI]]
- [[Directorios en disco]]
- [[Variables de entorno]]
