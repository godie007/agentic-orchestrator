---
tags: [capacidad, ide]
aliases: [Editor.tsx, Explorador.tsx, Buscar.tsx, monaco.ts, EditorDeArchivo, DiffDeArchivo, RaizDeRepo, construirArbol, buscarTexto, listarArchivos, leerArchivo, lenguajeDe, useTemaMonaco, Monaco]
---

# Editor, explorador y búsqueda

Las tres piezas con las que una persona lee y toca el código de la sesión desde
[[El IDE]]: el **editor** (Monaco, el de VS Code), el **explorador** con una
raíz por repo y el estado git de cada archivo, y la **búsqueda** en todo el
repo. Todo opera sobre el worktree de la sesión si hay una abierta, y sobre la
rama base del clon, en sólo lectura, si no.

## Monaco, empaquetado con la app

`apps/web/src/routes/codigo/monaco.ts` arma Monaco una sola vez para todo el IDE.

- **Sin CDN.** `loader.config({ monaco })` le pasa a `@monaco-editor/react` la
  instancia local en vez de dejar que la baje de jsdelivr: un IDE que deja de
  abrir archivos cuando no hay red —o cuando el CDN tarda— no es un IDE.
- **Workers de Vite.** `self.MonacoEnvironment.getWorker` elige por etiqueta:

| Etiqueta | Worker |
|---|---|
| `json` | `json.worker` |
| `css`, `scss`, `less` | `css.worker` |
| `html`, `handlebars`, `razor` | `html.worker` |
| `typescript`, `javascript` | `ts.worker` |
| cualquier otra | `editor.worker` |

- **Sin diagnósticos semánticos de JS/TS** (`noSemanticValidation: true`,
  `noSyntaxValidation: false`). El editor no tiene el proyecto entero cargado:
  cada `import` sin resolver sería un subrayado rojo falso. Quedan la sintaxis,
  el resaltado y el autocompletado; la verificación de verdad es `npm test` o
  `tsc` en la [[Terminal del IDE]]. Opciones de compilador: `ESNext`, módulos
  `ESNext`, resolución `NodeJs`, `jsx: ReactJSX`, `allowJs`.
- **Temas propios** `orq-oscuro` y `orq-claro`, con los mismos fondos que la app
  (los `--t-*` de `styles.css` pasados a hex): con el `vs-dark` puro el editor
  quedaba como una ventana de otra aplicación pegada en el medio.
  `useTemaMonaco` sigue el tema en vivo: observa `data-theme` en `<html>` con un
  `MutationObserver` y, si no hay uno elegido, `prefers-color-scheme`.
- **Una promesa rechazada silenciada, por nombre.** Monaco cancela tareas al
  cerrar un editor y la cancelación sale como `Canceled: Canceled` sin dueño,
  una por pestaña cerrada. Se descarta sólo esa (nombre y mensaje exactos) para
  que no tape los errores que sí importan.
- `lenguajeDe(ruta)` traduce extensión → lenguaje de Monaco (`ts`/`tsx` →
  `typescript`, `glsl`/`frag`/`vert` → `cpp`, `toml` → `ini`, `vue`/`svelte` →
  `html`, `Dockerfile` y `Makefile` por nombre; lo demás `plaintext`), y
  `etiquetaDeLenguaje` lo muestra legible en la barra de estado.

## El editor

`apps/web/src/routes/codigo/Editor.tsx` → `EditorDeArchivo`.

**De dónde sale el texto.** El contenido de disco lo trae react-query
(`["archivo", repoId, ruta]` → `GET /api/repos/:id/archivo`). Lo que la persona
edita no vive en el editor sino en el mapa `ediciones` de `Codigo`, con clave
`repoId\0ruta`, hasta que se guarda: así cerrar y reabrir una pestaña, o pasar
del editor al diff, conserva lo editado. Si lo tipeado vuelve a ser igual al
original, deja de contar como cambio.

**Se refresca solo.** Mientras no haya cambios sin guardar, el archivo se vuelve
a pedir cada 3 s: es la forma de ver a un agente editar el archivo abierto. Con
cambios propios, el sondeo se apaga (el texto no se mueve debajo del cursor) y
entra en juego la regla del hash: ver "Guardar lleva el hash de lo que se
cargó" en [[El IDE]].

| Opción | Valor | Por qué |
|---|---|---|
| `fontSize` | 13 | |
| `fontFamily` | JetBrains Mono, SF Mono, Menlo, Consolas | con ligaduras |
| `minimap` | activo, sin caracteres | |
| `stickyScroll` | activo | la firma de la función queda arriba |
| `bracketPairColorization` / `guides` | activos | |
| `unicodeHighlight.ambiguousCharacters` | `false` | −, × o – son legítimos en comentarios en castellano y en fórmulas; marcarlos es ruido. Los invisibles se siguen marcando |
| `tabSize` | 2 | |
| `readOnly` | `soloLectura` | mientras un agente tiene el arriendo |

**Comandos registrados al montar:**

- **⌘S** guarda (sólo si hay cambios o es un archivo nuevo, y nunca en sólo
  lectura). Se registra una vez, así que llama a la función del render actual
  a través de una `ref`.
- **Agregar al chat de IA** (⌘L, menú contextual y paleta F1): con texto
  seleccionado manda `{ruta, desde, hasta, texto}`; sin selección, el archivo
  entero. Abre el chat. Ver [[Chat de IA]].
- La posición del cursor va a la barra de estado.

`irALinea` centra y enfoca una línea: lo usan la búsqueda y los enlaces
`ruta:línea` del chat.

**Lo que no abre.** `aContenido` (`apps/server/src/repos.ts`) marca como binario
un archivo con un byte NUL en los primeros 8.000 o de más de 2 MB
(`TOPE_EDITABLE`): el editor muestra "es binario o pesa más de 2 MB (N KB)". El
hash es un sha1 del contenido (`hashDe`).

## La vista de cambios

`DiffDeArchivo` es el `DiffEditor` de Monaco en sólo lectura, sin minimapa.

| Caso | Izquierda | Derecha |
|---|---|---|
| Default (desde el panel de control) | el archivo en la **base de la sesión** (`ref=base` → `sesion.baseSha`) | lo actual en el worktree, **incluida la edición sin guardar**, refrescado cada 3 s |
| Con `desde`/`hasta` (un pedido del chat, un commit del historial) | el archivo en `desde` | el archivo en `hasta`, fijo |

`desde`/`hasta` son shas (con `^` para el padre); el servidor los acepta con
`/^[0-9a-f]{7,40}\^?$/` y un commit inexistente —el padre del primero— cuenta
como "no existía". Un archivo nuevo o borrado no tiene "otro lado": en vez de
dos columnas con una mitad rayada se dibuja **en línea**, como VS Code
(`renderSideBySide` sólo si hay contenido de los dos lados).

## El explorador

`apps/web/src/routes/codigo/Explorador.tsx` → `Explorador` → una `RaizDeRepo` por
repo → `ArbolDeArchivos`.

### La raíz de un repo

- Muestra el nombre en mayúsculas, un chip con la rama (la de la sesión sin el
  prefijo `orq/`, o "base") y un punto ámbar si hay cambios. El `title` dice de
  dónde viene: la ruta local, la URL git, o "Creado por la empresa".
- Tocarla la abre o la cierra **y la vuelve el repo activo**.
- Acciones al pasar el mouse: archivo nuevo (no en sólo lectura), actualizar,
  renombrar (también con doble clic en el nombre), configurar (lleva a la vista
  Repositorio) y sacar del proyecto (con confirmación).
- Al montar, se abren la primera raíz o todas si hay tres o menos. "Colapsar
  todo" sube un contador (`generacion`) que es parte de la `key`: rearma las
  raíces cerradas, como el botón de VS Code.
- El árbol de cada raíz se pide sólo si está abierta o si hay un filtro, cada
  3 s.

**Renombrar** manda `POST /api/repos/:id/renombrar` (hasta 120 caracteres). Si
el servidor lo rechaza —el nombre se repite en el proyecto, y no puede porque es
el `repo=` de las herramientas— el campo queda abierto mostrando el motivo.
Salir sin haber cambiado nada lo cierra; con un cambio a medio escribir se
queda, para no tirar lo tipeado por un clic de más. No hace falta detener la
corrida: la carpeta `repos/<slug>` no se mueve. Ver [[Repositorios y sesiones]].

### Qué archivos lista

`RepoStore.listarArchivos` (`apps/server/src/repos.ts`):

- **Con sesión:** `git ls-files -z -co --exclude-standard` sobre el worktree.
  `-co` incluye los archivos nuevos que todavía no entraron a ningún commit —con
  `ls-files` a secas, lo que un agente acaba de crear no existía—, y
  `--exclude-standard` deja afuera lo ignorado (`node_modules`, `.env*` por el
  `info/exclude` del clon).
- **Sin sesión:** `git ls-tree -r HEAD` del clon, o sea la rama base, en sólo
  lectura. **Mirar no abre una sesión**: abrirla crea una rama, y quien sólo
  quería leer no tiene por qué dejar ramas atrás.

`construirArbol` arma las carpetas a partir de las rutas y ordena carpetas
primero y después por nombre (`localeCompare`).

### Estado git a la vista

`GET /api/repos/:id/archivos` trae, junto al árbol, los `cambios` de la sesión:
lo commiteado desde la base (`git diff --name-status baseSha HEAD`) más lo
pendiente (`git status`, donde un `??` cuenta como `A`).

| Letra | Color | Significa |
|---|---|---|
| A | verde | nuevo |
| M | ámbar | modificado |
| D | rojo | borrado |
| R | acento | renombrado |

El nombre del archivo se tiñe del mismo color, y **una carpeta con cambios
adentro también se marca** (texto ámbar y un punto): si no, un cambio en
`src/render/shader.js` quedaba escondido detrás de dos carpetas cerradas.

### Filtrar, crear, borrar

- **Filtrar** muestra una lista plana de rutas que contienen el texto (sin
  distinguir mayúsculas), con la carpeta al lado, hasta 200.
- **Archivo nuevo** pide una ruta (`src/utils/fecha.js`, sin `/` inicial) y abre
  una pestaña marcada `nuevo`: el archivo no existe hasta que se guarda, y se
  guarda con `hash: null`.
- **Borrar** (ícono de papelera de cada archivo) pide confirmación y manda
  `DELETE /api/repos/:id/archivo?ruta=…`. Abre la sesión si no había, rechaza
  carpetas y rutas que no existen, y cierra la pestaña del archivo. Si el
  archivo estaba en la base, el borrado queda como un cambio más que se puede no
  publicar.
- Un `.html` ofrece un ojo para abrirlo en la vista previa.

## La búsqueda

`apps/web/src/routes/codigo/Buscar.tsx` → `Buscar`, y del lado servidor
`RepoStore.buscarTexto`.

- Se busca **al dejar de tipear** (300 ms) y desde 2 caracteres: cada búsqueda
  es un `git grep`.
- Dos interruptores: distinguir mayúsculas y expresión regular. Por default la
  búsqueda es **literal** (`-F`) y sin distinguir mayúsculas (`-i`): quien busca
  `suma(` no quiere un error de expresión regular. Con el interruptor, `-E`.
- Los resultados se agrupan por archivo con su contador; cada línea (recortada a
  300 caracteres) abre el archivo en esa línea.
- Tope de **500** líneas: pasado eso dice "se muestran los primeros 500".

| Con sesión | Sin sesión |
|---|---|
| `git grep -n -I --no-color --full-name [-F\|-E] [-i] --untracked -e <texto>` sobre el worktree | el mismo `git grep … -e <texto> HEAD` sobre el clon, y se le saca el `HEAD:` a cada ruta |

`--untracked` hace que un archivo recién creado exista para la búsqueda aunque
no esté commiteado; `-I` saltea binarios.

> [!danger] `git` con `--work-tree` necesita también `cwd`
> `grep --untracked` y `ls-files -o` trabajan sobre el directorio actual. Sin
> `cwd`, buscar en la sesión devolvía archivos **del orquestador**.
> `apps/server/src/git.ts` usa el worktree como `cwd` por default. Ver
> [[Git endurecido]].

## Leer un archivo, por dentro

`GET /api/repos/:id/archivo?ruta=…&ref=…` → `RepoStore.leerArchivo`:

- `ref` es `actual` (default), `base` o un sha (con `^` opcional). Cualquier otra
  cosa se trata como `actual`.
- **Actual** lee del worktree resolviendo la ruta con `resolverEnWorktree` sobre
  el `realpath`: no se sale del árbol, no se entra a `.git`, no se escapa por un
  symlink (ver [[Herramientas de código]]).
- **Base o sha** usa `git show <commit>:<ruta>`, rechazando rutas con `..` o
  `.git`. Si el archivo no estaba en ese commit, devuelve `contenido: null`: es
  el lado vacío de un diff de archivo nuevo.

## Constantes

| Nombre | Valor | Dónde | Por qué |
|---|---|---|---|
| `TOPE_EDITABLE` | 2 MB | `apps/server/src/repos.ts` | más que eso no se abre ni se guarda desde el editor |
| bytes mirados para "binario" | 8.000 | `aContenido` | un NUL ahí es binario |
| sondeo del archivo | 3 s | `EditorDeArchivo` | ver al agente editar |
| espera de la búsqueda | 300 ms | `Buscar` | un `git grep` por pausa, no por tecla |
| mínimo para buscar | 2 caracteres | `Buscar` | |
| tope de resultados | 500 líneas | `buscarTexto` | |
| recorte por línea | 300 caracteres | `buscarTexto` | |
| tope del filtro | 200 rutas | `ArbolDeArchivos` | |

## Casos borde

- **Un archivo borrado sin commitear** sigue en el índice, así que aparece en el
  árbol con una **D**; abrirlo dice que no existe.
- **Sin sesión** todo es de la base: no hay marcas, y guardar o borrar abre la
  sesión.
- **Regex inválida** con el interruptor de expresión regular: `git grep` falla y
  la búsqueda vuelve vacía (se corre tolerando el error).
- **Dos repos con el mismo nombre de archivo**: cada pestaña lleva el nombre del
  repo al lado cuando hay más de uno.

## Qué fijan los tests

- `apps/server/src/repos.test.ts` → "RepoStore desde el IDE":
  - sin sesión se lee la rama base y listar no abre una sesión;
  - guardar con el hash de lo que se cargó escribe; con uno viejo no pisa lo que
    cambió en disco;
  - un archivo nuevo se guarda con hash `null`, y no se puede escribir en `.git`
    ni fuera del árbol;
  - la base del diff es cómo estaba el archivo al abrir la sesión, y un archivo
    que no existía devuelve `null`;
  - buscar encuentra texto literal en la sesión, incluidos los archivos nuevos, y
    sin sesión busca en la base.
- `packages/tools/src/codigo/codigo.test.ts` → "resolverEnWorktree": no deja salir
  del árbol, entrar a `.git` ni escapar por un symlink.

## Fuentes

- `apps/web/src/routes/codigo/monaco.ts` → `MonacoEnvironment`, `useTemaMonaco`, `lenguajeDe`, `etiquetaDeLenguaje`
- `apps/web/src/routes/codigo/Editor.tsx` → `EditorDeArchivo`, `DiffDeArchivo`, `OPCIONES_BASE`
- `apps/web/src/routes/codigo/Explorador.tsx` → `Explorador`, `RaizDeRepo`, `ArbolDeArchivos`, `construirArbol`, `marcaDeEstado`, `IconoDeArchivo`
- `apps/web/src/routes/codigo/Buscar.tsx` → `Buscar`
- `apps/web/src/routes/Codigo.tsx` → `ediciones`, `claveEdicion`, `alEditar`, `alGuardar`
- `apps/server/src/rutas-codigo.ts` → `GET /api/repos/:repoId/archivos`, `/archivo`, `/buscar`, `DELETE /archivo`, `POST /renombrar`
- `apps/server/src/repos.ts` → `listarArchivos`, `leerArchivo`, `escribirArchivo`, `buscarTexto`, `borrarArchivo`, `estado`, `aContenido`

## Ver también

- [[El IDE]] · [[Panel de control de código]] · [[Chat de IA]]
- [[Repositorios y sesiones]] · [[Git endurecido]] · [[Herramientas de código]]
- [[Sistema de diseño y temas]]
