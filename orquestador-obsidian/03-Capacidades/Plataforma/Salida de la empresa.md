---
tags: [capacidad, plataforma]
aliases: [ExportStore, exports.ts, Directorio de salida, .orq-generado.json, Manifiesto de procedencia, safePath, safeSegment, publicar, vaciarGenerado]
---

# Salida de la empresa

`apps/server/src/exports.ts` → `ExportStore` es el directorio donde cae **lo que
la empresa produce como archivo**: los Word, PDF, videos, decks, imágenes y
cualquier cosa que un agente escriba con `write_output_file`. Los entregables
(`write_artifact`) viven en SQLite como texto; un Word o un video son bytes que
alguien descarga, y por eso van a disco, en un árbol propio por empresa y
organizado en carpetas.

El problema de fondo es que **las rutas las propone un modelo**. Una clave de
entregable como `../../.env` escribiría fuera del directorio, y ese texto lo
elige el agente —un prompt puede influirlo—. Todo lo que entra se sanea acá,
segmento por segmento, y no se confía en nada.

Las herramientas que usan los agentes sobre este directorio y la regla de
jerarquía (`puedeBorrar`) están en [[Archivos de salida y permisos de borrado]];
esta nota es el store por dentro.

## Dónde cae: la disposición

El store no decide el layout: lo recibe (`DisposicionDeSalida`).

| Campo | Qué es |
|---|---|
| `raiz` | la raíz de las carpetas de primer nivel, una por empresa |
| `salida(id)` | dónde está o **estaría** la salida. No crea nada |
| `asegurarSalida(id)` | la salida, creada si faltaba |
| `carpetaDe(id)` | la carpeta de primer nivel de la empresa: es lo que se borra con ella |
| `duenioDe(carpeta)` | de qué empresa es una carpeta de primer nivel, o `null` |

| Disposición | Carpeta | Quién la usa |
|---|---|---|
| `disposicionPorId(raiz)` | `raiz/<safeSegment(id)>`; el nombre **es** el dueño | tests y seeds (`new ExportStore("…")`) |
| `disposicionPorProyecto(directorios)` | `<Nombre legible>/salida`; el dueño sale de la marca `.empresa`; `carpetaDe` es el proyecto entero | el servidor (`Runtime`) |

El constructor crea la raíz (`mkdirSync`). Ver [[Directorios en disco]].

## El saneo de rutas

`ExportStore.safeSegment(raw)` deja lo que puede ser **un** segmento:

1. `normalize("NFKD")` y se descartan las marcas combinantes: "Área" → "Area".
   Sin ese paso quedaba "A-rea", porque NFKD separa la tilde en un carácter
   propio que el paso siguiente tomaba por basura.
2. Todo lo que no sea `[\w.-]` pasa a `-`; `..` y más puntos seguidos quedan en
   uno; se sacan puntos y guiones iniciales, guiones repetidos y finales.
3. Máximo 80 caracteres; si no queda nada, `sin-nombre`.

`ExportStore.safePath(raw)` parte por `/` o `\`, descarta vacíos, `.` y `..`,
sanea cada segmento y **corta en 6 niveles** ("más profundidad que esto no
organiza nada, esconde"). Devuelve **segmentos**, nunca una cadena: quien la usa
arma la ruta con `join`, y así no hay forma de reintroducir un `..`.

`resolveDentro(id, relativa, crear)` es el último filtro: resuelve contra la
salida y exige que el destino sea la salida o algo **debajo** de ella
(`startsWith(dir + sep)`). Es una verificación léxica (`path.resolve`, no sigue
enlaces simbólicos); hoy ningún camino del orquestador crea un enlace adentro de
la salida.

| Pedido | Resultado (tests) |
|---|---|
| `save("../../../robado.docx")` | `robado.docx`, adentro |
| carpeta `../../fuera/../../mas-fuera` | `fuera/mas-fuera/…` |
| `createFolder("Área Comercial/2026")` | `Area-Comercial/2026` |
| `safePath("a/b/c/d/e/f/g/h")` | 6 segmentos |
| `createFolder("../..")`, `read("..")`, `remove("///")` | `null` / `ok: false` |

## `pathFor`, `dirFor` y `dirDeEmpresa`

| Método | Crea la carpeta | Lo usan |
|---|---|---|
| `pathFor` (privado) | no | `tree`, `read`, `remove`, `pesoDe`, `rutaDe`, el manifiesto al leer |
| `dirFor` (privado) | sí | escribir: `save`, `writeText`, `createFolder`, `publicar`, guardar el manifiesto |
| `dirDeEmpresa` (público) | sí | `Runtime.startRun` (para prestarle la salida al CLI en sólo lectura) y `contextoAab` |

> [!danger] Consultar no puede escribir
> `dirFor` crea la carpeta al pasar. Con él, pedir el árbol de una empresa que ya
> no está la dejaba de nuevo en disco, y un barrido de residuos **producía los
> residuos que venía a buscar**. Todo el camino de lectura y medición usa
> `pathFor`. `dirDeEmpresa` crea a propósito: se llama al arrancar una corrida,
> que es justo cuando la empresa la va a necesitar.

## El manifiesto de procedencia

`.orq-generado.json` dentro de la salida: `{ "paths": [ … ] }`, ordenado. Dice
**qué escribió la empresa**. Vive en un archivo oculto y no en la base para que
`ExportStore` siga sin depender de SQLite y el registro viaje con los archivos.
El árbol ignora los nombres que empiezan con punto, así que no aparece.

| Operación | Efecto en el manifiesto |
|---|---|
| `forCompany().save`, `writeText` | agrega la ruta |
| `remove` (cualquiera) | la saca: un archivo borrado y vuelto a traer a mano deja de ser propio |
| `publicar` | mueve la entrada a `publicado/…` |
| manifiesto ausente o ilegible | conjunto vacío: **todo cuenta como externo** (falla seguro) |

Lo que no pasa por el store no se marca: lo que sube una persona (el logo en
`marca/logo.png`), los respaldos de un repo (`respaldos/*.bundle` y `.patch`,
escritos con git y `writeFile` por `RepoStore`) y el AAB con su `.json`
(`builds/android/`, copiado por `aab.ts`, **a propósito** fuera del manifiesto
para que un agente no lo pueda borrar). En la UI esos archivos llevan la
etiqueta "externo" si además no son multimedia (`Output.tsx`).

## Lo que ve un agente: `forCompany`

`forCompany(id)` devuelve el `SkillStorage` que el servidor inyecta a las
habilidades (`packages/tools` no decide dónde van los archivos):

| Método | Hace |
|---|---|
| `save({ filename, folder, bytes })` | sanea carpeta y nombre, **crea la carpeta sola** (pedirle un paso aparte agrega una llamada que el agente a veces olvida), escribe, marca, devuelve `url`, `path`, `sizeBytes` |
| `list()` | `flatList` |
| `remove(path)` | `removeComoAgente` |
| `removeMany(criterio)` | borrado en lote |
| `writeText(path, content)` | crea o **sobrescribe** (versionar acá duplicaría lo que hace `write_artifact`) y marca |
| `resolve(path)` | `rutaDe`: la ruta real de un archivo existente, por el mismo saneo, para que una habilidad lo abra (una imagen del guion, el logo) |

## Borrar

| Quién | Método | Puede borrar |
|---|---|---|
| Persona (UI) | `remove` | **cualquier archivo**, sin papelera; no carpetas |
| Agente, por procedencia | `removeComoAgente` | multimedia, o lo que está en el manifiesto |
| Agente, por jerarquía | `puedeBorrar` (en la herramienta, antes de llamar al store) | ver [[Archivos de salida y permisos de borrado]] |

`removeComoAgente` rechaza con un motivo que el agente puede reenviar: "no lo
generó la empresa y no es multimedia… lo hace una persona desde el panel de
salida". `removeMany({ kind: "multimedia" | "documents" | "all", folder?,
excluir? })` filtra por alcance y tipo, descarta lo excluido (lo que la
herramienta ya descartó por jerarquía) y pasa **cada** archivo por
`removeComoAgente`: "borrá todo" no es una excusa para llevarse algo ajeno.
Devuelve `borrados` y `fallidos` con su motivo. Es una sola llamada a propósito:
encadenar una por archivo hacía que el agente fallara a la mitad.

## El árbol

`tree(id)` devuelve un `TreeFolder` con raíz `salida`: carpetas primero, cada
grupo alfabético, sin los ocultos. Cada `TreeFile` trae `path` (relativo, con
`/`), `sizeBytes`, `modifiedAt`, `esMultimedia` (por extensión:
`EXTENSIONES_MULTIMEDIA`) y `generadoPorAgente` (por manifiesto). Una empresa sin
salida devuelve un árbol vacío, no un error. `flatList` es el mismo árbol
aplanado. La pestaña Salida lo pide cada 5 s (`refetchInterval` en
`apps/web/src/routes/Output.tsx`).

## Publicar

`publicar(id, ruta, { reemplazar })` mueve un archivo a `publicado/`. Es la
única acción del circuito que **no** tiene herramienta de agente: sólo la
alcanza `POST /api/companies/:companyId/exports-publicar/*`. Que el archivo
cambie de carpeta hace de "aprobado" un hecho verificable en el disco. Ver
[[ADR-008 Publicar lo decide una persona]].

1. Ruta inválida → error; algo que ya está en `publicado/` → "Ya está publicado".
2. **Conserva la subcarpeta**: `campania/pieza.pdf` → `publicado/campania/pieza.pdf`.
   Aplanar hacía que `folleto/pieza.pdf` pisara a la primera sin que nadie lo
   notara. Se corta en 6 segmentos.
3. Si el destino existe y no vino `reemplazar`, devuelve `existe: true` y la ruta
   contesta **409**; la UI ofrece "reemplazar" y reintenta con `?reemplazar=1`.
4. `rename` y la entrada del manifiesto se muda con el archivo.

> [!warning] `publicado/` no tiene protección propia
> - Un agente puede **escribir** adentro de `publicado/` con `save` o
>   `writeText`: nada rechaza esa carpeta. Mover es de la persona; escribir no.
> - Lo publicado **sigue en el manifiesto**, así que cuenta como de la empresa:
>   un rol `executive` puede borrar un PDF publicado, un `manager` un video
>   publicado, y "Vaciar la salida" (`vaciarGenerado`) también se lo lleva.

## Mirar antes de descargar

`previewLiviano(nombre)` resuelve por extensión sin leer un byte:

| Extensión | `kind` | Cómo lo muestra la UI |
|---|---|---|
| `pdf` | `pdf` | iframe con la URL `?inline` |
| `html`, `htm` | `page` | iframe con `sandbox=""`: el archivo sale del mismo origen que la app y un `.html` de un agente no puede correr con su sesión |
| imagen | `image` | `<img>` |
| `mp4`, `webm`, `mov`, `m4v` | `video` | `<video controls>` |
| audio | `audio` | `<audio controls>` |

`previewDe(nombre, bytes)` agrega texto (`md`, `txt`, `csv`, `json`, `log`,
`yml`, `yaml`, `xml`) tal cual, y **Word**: `textoDeDocx` abre el zip con JSZip,
lee `word/document.xml` y rearma párrafos y tablas. Sin eso el único formato que
la empresa produce en Word sería justo el que no se puede revisar antes de
mandarlo.

> [!warning] El orden al desarmar el XML
> `</w:p></w:tc>` se reduce a `</w:tc>` **antes** que nada: la celda es
> `<w:tc><w:p>…</w:p></w:tc>`, y tratar ese cierre de párrafo como salto partía
> cada celda en su renglón. Después: celdas → ` | `, filas y párrafos → salto,
> se sacan etiquetas y se decodifican las entidades.

Lo que no tiene vista previa devuelve `none` con un motivo ("Descargalo para
abrirlo"). La ruta `exports-preview` usa `pesoDe` para los livianos: cargar cien
megas de video para después descartarlos es la diferencia entre una pestaña que
abre y un servidor que se cae.

La descarga (`GET /api/companies/:companyId/exports/*`) va como `attachment`
salvo con `?inline` —un `attachment` dentro de un iframe dispara la descarga en
vez de dibujarse—, con `contentTypeOf` (sin el tipo de `html` el navegador bajaba
el deck en vez de dibujarlo) y soporte de rangos (`206`/`416`) para que la barra
del `<video>` se pueda arrastrar.

> [!note] Límite conocido
> La ruta de descarga lee el archivo **entero** a memoria (`read`) aun para un
> pedido de rango, y recorta después. Con videos grandes cada salto de la barra
> vuelve a leer el archivo completo.

## Limpieza

`medirEmpresa` (pesa la carpeta **entera** del proyecto: salida, clones,
worktrees y tmp; no la crea), `removeCompany`, `carpetasResiduales`,
`removeCarpeta` y `vaciarGenerado` (el manifiesto y nada más: conserva el logo)
están explicados en [[Limpieza y mantenimiento]].

## Quién más escribe en la salida

| Carpeta | Quién | ¿En el manifiesto? |
|---|---|---|
| la que elija el agente | habilidades (`export_*`, `write_output_file`…) | sí |
| `imagenes/` | caché de imágenes generadas | sí |
| `revision/` | `extraer_cuadros`, captura del teléfono (`depuracion-movil.ts`) | sí |
| `revision/r2` | descargas de R2 (`r2.ts`) | sí |
| `respaldos/` | `RepoStore` al sacar un repo con trabajo sin integrar | no |
| `builds/android/` | `aab.ts` | no, a propósito |
| `marca/logo.png` | la persona | no |
| `publicado/` | la persona (publicar) | sí, la entrada se muda |
| `reconocimiento/` | el MCP de Playwright con `--output-dir` | no |

## Qué fijan los tests

`apps/server/src/exports.test.ts`:

- **Saneo**: no se escapa del directorio ni por el nombre ni por la carpeta; la
  profundidad se corta en 6; una ruta que se sanea a nada no lee ni borra.
- **Carpetas**: se crean solas al exportar; se pueden crear vacías; orden
  carpetas-primero alfabético; el árbol informa tamaño y multimedia.
- **Borrado**: cualquier archivo desde la UI; nunca una carpeta; avisa si no
  existe.
- **Agente**: borra lo generado y la multimedia; no toca lo que trajo una
  persona; el lote tampoco; el árbol dice la procedencia; el manifiesto no
  aparece; borrado y vuelto a traer deja de ser propio.
- **Tipos y vista previa**: multimedia sin importar mayúsculas; `contentTypeOf`;
  PDF e imagen por URL; texto tal cual; `.docx` real con párrafos y tablas;
  motivo cuando no hay vista previa.
- **Limpieza**: borrar la empresa informa lo que se llevó; medir no crea;
  residuales contra el id saneado; `removeCarpeta` no sale de la raíz; vaciar
  conserva el logo y es idempotente.

`apps/server/src/directorios.test.ts` fija el store sobre el layout por
proyecto y `publicar` (subcarpeta conservada, 409 sin `reemplazar`).

## Cómo extender

- **Un tipo de vista previa**: sumá la extensión en `previewLiviano` (si el
  navegador lo dibuja desde la URL) o en `previewDe` (si hay que leerlo), el
  tipo en `contentTypeOf` y el caso en `VistaPrevia` de `Output.tsx`.
- **Algo nuevo que escribe en la salida**: pasá por `forCompany(id).save` si es
  producción de la empresa (queda marcado y un agente lo puede limpiar);
  escribí directo sólo si querés que cuente como externo, como el AAB.
- **Nunca** armes una ruta de salida con concatenación: `safePath` +
  `resolveDentro`, o `rutaDe` para abrir.

## Fuentes

- `apps/server/src/exports.ts` → `ExportStore`, `DisposicionDeSalida`, `disposicionPorId`, `disposicionPorProyecto`, `safeSegment`, `safePath`, `resolveDentro`, `forCompany`, `removeComoAgente`, `removeMany`, `publicar`, `tree`, `vaciarGenerado`, `previewLiviano`, `previewDe`, `textoDeDocx`, `contentTypeOf`
- `apps/server/src/routes.ts` → rutas `exports`, `exports-preview`, `exports-publicar`, `exports-vaciar`
- `apps/server/src/runtime.ts` → `startRun` (`dirDeEmpresa`), `telefonoStorage`, `registrarCodigoEn` (R2)
- `apps/server/src/repos.ts` → respaldos; `apps/server/src/aab.ts` → `builds/android`
- `packages/tools/src/skills/permisos.ts` → `puedeBorrar`
- `apps/web/src/routes/Output.tsx` → árbol, vista previa, publicar

## Ver también

- [[Archivos de salida y permisos de borrado]]
- [[Pantalla Salida]]
- [[Directorios en disco]]
- [[Limpieza y mantenimiento]]
- [[Misiones programadas]] — el circuito que termina en publicar
- [[Seguridad]]
