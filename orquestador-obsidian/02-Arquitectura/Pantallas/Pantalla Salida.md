---
tags: [arquitectura, pantalla]
aliases: [Output.tsx, Output, Directorio de salida, Vista previa de la salida, Publicar desde la UI]
---

# Pantalla Salida

**Ruta:** `/p/:companyId/salida`. **Componente:**
`apps/web/src/routes/Output.tsx` → `Output`.

El árbol de lo que la empresa produjo como archivo: los entregables viven en la
base como texto, y acá está lo que las habilidades convirtieron en Word, PDF,
video, deck o imagen. Se muestra como árbol y no como lista porque la salida se
organiza en carpetas por tema, y treinta documentos en fila no le sirven a nadie.
Desde acá se **mira antes de descargar**, se crean carpetas, se borra y se
**publica**. El directorio en disco es `data/proyectos/<Nombre>/salida/`
([[Directorios en disco]]); cómo lo maneja el servidor, en
[[Salida de la empresa]].

## Datos

| Clave | Pedido | Refresco |
|---|---|---|
| `["export-tree", companyId]` | `GET /api/companies/:id/exports` → `TreeFolder` | 5 s, también en segundo plano: lo que exporta un agente aparece solo |
| `["export-preview", companyId, ruta]` | `GET /api/companies/:id/exports-preview/*` | al elegir un archivo |

`TreeFile` trae `name`, `path`, `sizeBytes`, `modifiedAt`, `esMultimedia` y
`generadoPorAgente` (sale del manifiesto `.orq-generado.json`, que no aparece en
el árbol). Carpetas primero y orden alfabético, del lado del servidor.

## El árbol

Grilla `grid-cols-[minmax(0,420px)_1fr]`: árbol a la izquierda, vista previa a
la derecha. La leyenda del panel resume la regla de borrado: "los agentes borran
multimedia y lo que generaron · vos, cualquier cosa".

- **+ carpeta**: un campo (placeholder `comercial/propuestas`, admite
  subcarpetas) y el botón, o Enter → `POST /api/companies/:id/exports/folders`.
  Una ruta que el saneo deja vacía contesta 400 ("no es una ruta válida dentro de
  la salida").
- **Carpetas**: se pliegan (▾/▸, abiertas por defecto), con la cantidad de
  archivos adentro o "vacía". No se borran desde acá: el borrado es de archivos.
- **Archivos**: ícono por extensión (PDF, Word, imagen, video, audio o genérico),
  el nombre —que **abre la vista previa**: mirar antes de bajar es lo que uno
  quiere casi siempre—, el peso, **↓** para descargar, y la marca **externo** si
  no lo generó la empresa y no es multimedia ("un agente no puede borrarlo. Vos
  sí, desde acá").
- **borrar**: un archivo multimedia se borra de una; cualquier otro pide "¿seguro?
  no se puede deshacer" en la misma fila, porque un entregable es el trabajo de la
  empresa y no hay papelera → `DELETE /api/companies/:id/exports/*`.

El borrado desde la UI **no pasa por las reglas de jerarquía** de los agentes
(`puedeBorrar`, el manifiesto): ahí decidís vos. El servidor sólo rechaza una ruta
inválida, una carpeta o un archivo que no existe, y el motivo aparece en la franja
de error. Ver [[Archivos de salida y permisos de borrado]].

Vacío: "Todavía no hay archivos. Un agente con la habilidad `export_docx` o
`export_pdf` los produce, y puede crear la carpeta destino sola."

> [!note] No hay subida de archivos
> La pantalla no tiene cómo traer un archivo propio: el logo
> (`marca/logo.png`), las fotos o cualquier material externo se copian a mano a
> la carpeta de salida del proyecto. Lo que llega así queda como externo.

## La vista previa

`VistaPrevia` pide el tipo y dibuja según `kind`:

| `kind` | Extensiones | Cómo se dibuja |
|---|---|---|
| `pdf` | `pdf` | `<iframe>` sobre la URL con `?inline` |
| `page` | `html`, `htm` | `<iframe sandbox="">` con `?inline` |
| `image` | `png`, `jpg`, `jpeg`, `gif`, `webp`, `svg`, `bmp` | `<img>` con `?inline` |
| `video` | `mp4`, `webm`, `mov`, `m4v` | `<video controls>`: el servidor responde rangos (206), así la barra de tiempo se puede arrastrar |
| `audio` | `mp3`, `wav`, `m4a`, `ogg`, `aac`, `flac` | `<audio controls>` |
| `text` | `md`, `txt`, `csv`, `json`, `log`, `yml`, `yaml`, `xml`, y `docx` | `<pre>` con el texto que devolvió el servidor |
| `none` | el resto, o un `.docx` vacío | el motivo ("No hay vista previa para archivos .x. Descargalo para abrirlo.") |

Tres decisiones que no son estéticas:

- **`?inline`**: la URL de descarga responde `Content-Disposition: attachment`, y
  un `attachment` dentro de un iframe **dispara la descarga en vez de dibujarse**.
  Con `?inline` el mismo archivo se sirve para mostrarse. Para PDF, imagen, video y
  audio el servidor ni lee el archivo: contesta el tipo y el peso, y el navegador
  lo pide por la URL.
- **Word se lee como texto**: ningún navegador abre un `.docx`, así que el servidor
  extrae el texto de `word/document.xml` conservando párrafos y tablas (celdas
  separadas por barras). Sin eso, el único formato que la empresa produce en Word
  sería justo el que no se puede revisar antes de mandarlo.
- **`sandbox=""` sin `allow-same-origin`**: el `.html` se sirve desde el mismo
  origen que la aplicación, y un archivo que escribió un agente no puede correr
  con tu sesión. Se le permite dibujarse y nada más: sin scripts. El deck de
  `export_slides` es CSS puro y se ve entero ([[Deck de slides]]).

Encabezado de la vista previa: el nombre, el peso, **✓ publicar** (salvo lo que ya
está en `publicado/`) y **↓ descargar**. Sin archivo elegido: "Elegí un archivo
del árbol para verlo sin descargarlo."

## Publicar

Publicar es **lo único del circuito que un agente no puede hacer**: la misión
produce, avisa por correo y espera; acá alguien dice que sí
([[ADR-008 Publicar lo decide una persona]], [[Misiones programadas]]).

**✓ publicar** → `POST /api/companies/:id/exports-publicar/*`. El servidor mueve
el archivo a `publicado/` **conservando la subcarpeta**, así "aprobado" es un
hecho verificable en el disco. Si ya hay una versión publicada contesta **409**
("Ya hay una versión publicada en … Confirmá para reemplazarla.") y la pantalla
ofrece **reemplazar** junto al mensaje, que reintenta con `?reemplazar=1`: publicar
no pisa en silencio.

> [!warning] El 409 se reconoce por el texto
> El cliente descarta el campo `existe` de la respuesta de error, así que la
> pantalla decide si ofrecer "reemplazar" buscando "Ya hay una versión publicada"
> en el mensaje. Cambiar esa frase en `apps/server/src/exports.ts` apaga el botón.

## Casos borde

- **Cambiar de proyecto** con el selector del header no remonta la pantalla (su
  ruta es la única sin `key`): queda elegido el archivo del proyecto anterior y la
  vista previa muestra un error hasta elegir otro.
- **Después de publicar** el archivo se mudó a `publicado/` pero la vista previa
  sigue apuntando a la ruta vieja.
- El comentario del código dice que el servidor "rechaza borrar un entregable":
  ya no; desde la UI se borra cualquier archivo (lo fija un test).

## Qué fijan los tests

`apps/server/src/exports.test.ts`: el saneo de rutas ("no deja escapar del
directorio de la empresa"), crear carpetas vacías desde la UI, el orden y los
datos del árbol ("el árbol informa tamaño y distingue multimedia de entregable",
"el árbol dice de dónde vino cada archivo", "el manifiesto no aparece como un
archivo más"), el borrado ("desde la UI se borra igual: ahí decide una persona",
"no borra una carpeta", "avisa cuando el archivo no existe") y la vista previa ("el
PDF y las imágenes las dibuja el navegador", "extrae el texto de un .docx real",
"una tabla de .docx se sigue leyendo como tabla", "dice por qué no puede
previsualizar").

## Fuentes

- `apps/web/src/routes/Output.tsx` — `Output`, `Nodo`, `contarArchivos`,
  `VistaPrevia`, `ICONO`.
- `apps/web/src/api.ts` — `exportTree`, `createFolder`, `deleteFile`,
  `publishFile`, `exportUrl`, `exportInlineUrl`, `exportPreview`, `TreeFile`,
  `TreeFolder`.
- `apps/server/src/routes.ts` — rutas `exports*`.
- `apps/server/src/exports.ts` — `ExportStore.remove`, `publicar`,
  `previewLiviano`, `previewDe`, `textoDeDocx`.

## Ver también

- [[Salida de la empresa]]
- [[Archivos de salida y permisos de borrado]]
- [[Documentos Word y PDF]]
- [[CU-03 Misión semanal con aprobación humana]]
- [[Pantalla Configuración]] — vaciar la salida
