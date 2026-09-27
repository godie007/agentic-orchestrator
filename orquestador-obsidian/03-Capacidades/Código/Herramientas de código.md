---
tags: [capacidad, código]
aliases: [Herramientas para programar, crearHerramientasDeCodigo, CodigoStorage, EspacioDeCodigo, leer_codigo, editar_codigo, escribir_codigo, aplicar_parche, buscar_codigo, buscar_archivos, mapa_del_codigo, estado_git, revertir_codigo, listar_repositorios, resolverEnWorktree, LINEAS_POR_LECTURA, indice.ts]
---

# Herramientas de código

Las 16 herramientas con las que un agente trabaja sobre un repo, creadas por
`crearHerramientasDeCodigo` en `packages/tools/src/codigo/index.ts`. Son
`origin: "skill"` —siempre expuestas por el router, otorgadas por rol como
cualquier habilidad— y ninguna pide aprobación: los frenos están en el
ejecutor (el arriendo, la allowlist, el sandbox, la resolución de rutas).

## De dónde sale el diseño

No se inventó un estilo de edición: se tomó lo que ya funciona en los harness
de código que existen.

| Idea | De dónde | Acá |
|---|---|---|
| Editar por **reemplazo exacto y único** | el `str_replace` de Claude Code y el editor de SWE-agent | `editar_codigo` |
| Leer **con números de línea** y por ventanas | la herramienta `Read` de un agente de código | `leer_codigo` |
| Buscar con **`git grep`** | ripgrep/grep de cualquier harness | `buscar_codigo` |
| Orientarse con un **mapa de símbolos** | el *repo map* de Aider | `mapa_del_codigo` |

Lo propio es **dónde viven los frenos**: el arriendo de escritura, la allowlist
y el sandbox los aplica el ejecutor, no el prompt.

## El servidor les presta el repo (`CodigoStorage`)

Las herramientas no saben dónde vive un repo, cómo se llama su `--git-dir` ni
quién tiene el arriendo: todo eso lo resuelve el servidor, igual que
`SkillStorage` resuelve la salida. Así `packages/tools` sigue sin decidir rutas
(`packages/tools/src/codigo/tipos.ts`, implementado por `crearCodigoStorage` en
`apps/server/src/codigo-servidor.ts`):

| Método | Qué hace |
|---|---|
| `listar()` | los repos con su sesión (rama, cantidad de checkpoints), comandos y servicios |
| `espacio(repo, ctx)` | el `EspacioDeCodigo` de un repo: **abre la sesión si no había** |
| `puedeEscribir(repoId, ctx)` | ¿este turno tiene el arriendo? Si no, por qué (y quién escribe) |
| `git(espacio, args, {entrada})` | git dentro del worktree, con `--git-dir` calculado desde el clon ([[Git endurecido]]) |
| `ejecutar(espacio, argv, opciones)` | un comando ya autorizado, en fila por repo ([[Comandos y sandbox]]) |
| `servicios`, `logsDeServicio`, `probarServicio` | los servicios levantados ([[Servicios del monorepo]]) |
| `consumirUnaVez(repoId, argv)` | gasta un permiso de una sola vez |
| `crear(nombre, descripcion, ctx)` | un repo nuevo ([[Repositorios y sesiones]]) |

`EspacioDeCodigo` trae `repoId`, `nombre`, `dir` (la raíz real del worktree),
`rama`, `baseSha`, `ramaBase`, `comandos` y `pendienteDeConfirmar`.

**Elegir el repo** (`elegirRepo`): el argumento `repo` acepta id, nombre (sin
distinguir mayúsculas) o slug. Con un solo repo es opcional; con varios y sin
`repo`, el error lista los nombres. Sin repos: "Los carga una persona desde la
pestaña Código".

## Registro

`Runtime.registrarCodigoEn` (`apps/server/src/runtime.ts`) las registra en el
`ToolRegistry` de la empresa **aunque todavía no haya repo**. Es la excepción
consciente a "la que no se puede cumplir no se registra": un proyecto nace de
una plantilla antes de que alguien cargue su código, y `generarEquipo` sólo
puede otorgar lo que está en el catálogo. Sin repo, el turno no abre el espacio
de código y cada herramienta contesta qué falta y quién lo carga.

Después de cargar o sacar un repo, `registrarHerramientasDeCodigo` las
re-registra y **siembra sus filas** en `tools` (`sembrarHerramientas`): sin
fila, `role.toolIds` no puede apuntarlas y nadie las puede recibir. El registro
es el de la empresa, que comparten las corridas vivas, así que lo ejecutable
les llega solo.

## Las 16, de un vistazo

| Herramienta | `readOnly` | Pide arriendo | Argumentos | Para qué |
|---|---|---|---|---|
| `listar_repositorios` | sí | no | — | repos, sesión, tests, permitidos, si puede escribir, servicios. "Empezá por acá" |
| `mapa_del_codigo` | sí | no | `carpeta?` | carpetas y archivos más importantes con sus símbolos |
| `buscar_codigo` | sí | no | `patron`, `archivos?`, `ignorarMayusculas?`, `contexto?` | `git grep` con regex extendida |
| `buscar_archivos` | sí | no | `patron` | archivos por glob |
| `leer_codigo` | sí | no | `ruta`, `desde?`, `limite?` | leer con números de línea, por ventanas |
| `editar_codigo` | no | **sí** | `ruta`, `buscar`, `reemplazar`, `todas?` | reemplazo exacto y único |
| `escribir_codigo` | no | **sí** | `ruta`, `contenido` | crear o reemplazar un archivo entero |
| `aplicar_parche` | no | **sí** | `parche` | un diff unificado, todo o nada |
| `estado_git` | sí | no | `ruta?`, `conDiff?` | qué cambió en la sesión contra la base |
| `revertir_codigo` | no | **sí** | `ruta?` o `checkpoint?` | volver un archivo o revertir un commit de la sesión |
| `ejecutar_comando` | no | no | `comando`, `segundos?`, `repetir?`, `carpeta?` | ver [[Comandos y sandbox]] |
| `solicitar_comando` | no | no | `comando`, `motivo` | ver [[Comandos y sandbox]] |
| `instalar_dependencia` | no | no | `paquetes`, `motivo`, `dev?`, `carpeta?` | ver [[Instalación de dependencias]] |
| `crear_repositorio` | no | no | `nombre`, `descripcion?` | ver [[Repositorios y sesiones]] |
| `servicios` | sí | no | `accion?` (`listar`/`logs`), `servicio?`, `lineas?` | ver [[Servicios del monorepo]] |
| `probar_servicio` | no | no | `servicio`, `ruta`, `metodo?`, `cuerpo?`, `cabeceras?` | ver [[Servicios del monorepo]] |

Todas aceptan `repo` salvo `crear_repositorio`, y todos los esquemas cierran con
`additionalProperties: false` (así el memo de lecturas calcula su huella sólo
sobre lo declarado; ver [[Turnos delegados a un CLI]]).

## Rutas: `resolverEnWorktree`

Toda ruta que propone un modelo pasa por `packages/tools/src/codigo/rutas.ts`.
**No se reusa `ExportStore.safePath`**: ese saneo está pensado para nombres de
entregables y rompe código —le saca el punto a `.gitignore`, convierte
`[id].tsx` en `-id-.tsx`, corta en seis niveles—. Acá la ruta se respeta tal
cual y lo que se verifica es **dónde cae**:

1. Se normalizan barras invertidas y un `./` inicial. Vacía → "Falta la ruta".
2. **Absoluta** → rechazada ("Usá rutas relativas a la raíz del repo").
3. Resuelta contra la raíz: si es la raíz misma o **se sale** (`..`) →
   rechazada.
4. **Cualquier segmento `.git`** → rechazada: un agente que escribe
   `.git/hooks/pre-commit` o `.git/config` convierte el próximo checkpoint en
   ejecución de código.
5. **Symlinks**: se busca el ancestro más profundo que existe, se resuelve con
   `realpath` y se verifica que la ruta final siga adentro de la raíz real. Un
   repo puede traer `docs -> /Users/persona`, y lo que se cree debajo caería
   afuera.

Devuelve `{ absoluta, relativa }`. La usan también el IDE (leer, guardar,
borrar), el panel de Git, la vista previa estática y la validación de carpetas
de servicios y comandos.

## Una por una

### `listar_repositorios`

Por repo: `## <nombre> (id …)`, rama base, sesión y checkpoints, tests,
verificar, comandos permitidos ("git status/diff/log siempre"), si puede
escribir en este turno (con el motivo), un aviso fuerte si la allowlist vino
importada sin confirmar, y los servicios del monorepo. Sin repos, dice que el
código nuevo va con `crear_repositorio` —"no escribas código en la salida"— y
que el existente lo carga una persona.

### `mapa_del_codigo`

El *repo map* de Aider sin sus dependencias (`packages/tools/src/codigo/indice.ts`):

- **Símbolos por regex, no por árbol sintáctico**: reglas por extensión para
  JS/TS (`.ts .tsx .mts .cts .js .jsx .mjs .cjs .vue .svelte`), Python, Go,
  Rust, Java, Kotlin/Scala, C#, PHP, Ruby y Swift. Cada regla dice qué es: clase
  (`C`), función (`ƒ`), método (`m`), tipo (`T`) o constante (`k`). Hasta 200
  símbolos por archivo; líneas de más de 400 caracteres no se miran.
- **Importancia por referencias, no por PageRank**: cuántos otros archivos
  nombran cada símbolo definido. El peso se descuenta por largo —un `get` que
  define medio repo no dice nada—: `(refs − 1) × min(1, largo/8)`. Suman los
  archivos de entrada (`index`, `main`, `app`, `server`, `cli`, `__init__`,
  `mod`, `lib`: +3) y restan los de test (−2).
- **Acotado por caracteres, no por cantidad**: presupuesto de 9.000
  caracteres. La cabecera (cantidad de archivos, hasta 60 carpetas con su
  conteo) entra siempre; después los archivos de más peso con hasta 12 símbolos
  (`nombre:línea`). Lo que no entra se nombra: "… y N archivos más que no entran
  en el mapa. Buscalos con buscar_archivos…".
- **Caché por archivo** (ruta + `mtime` + tamaño), por worktree, en memoria del
  proceso. No se persiste índice: lo que editó el CLI con su propio `Edit` —que
  el org no ve— invalida su entrada solo. Se indexan hasta 4.000 archivos de
  hasta 256 KB, sin binarios.
- **Determinista**: el mismo árbol da el mismo texto, así el memo de lecturas
  lo reconoce y dos agentes ven lo mismo.
- La lista de archivos es la de `ls-files -co --exclude-standard`: incluye lo
  que un agente creó y todavía no entró a un commit.

### `buscar_codigo`

`git grep -n -I -E --untracked --full-name --no-color` —`--untracked` porque un
archivo recién creado existe aunque no esté commiteado—, con `-i` opcional,
`-C0..5` de contexto y un glob (`:(glob)…`) para acotar. Cada línea se corta a
300 caracteres y el total a 12.000 (`TOPE_BUSQUEDA`), con "… y N más. Acotá con
'archivos' o un patrón más específico". Sin coincidencias no es un error: "Sin
coincidencias para /patrón/".

### `buscar_archivos`

Un glob (`globARegex`, `packages/tools/src/codigo/glob.ts`) sobre
`ls-files -co --exclude-standard`, sin dependencias: `*` no cruza carpetas,
`**` sí, `?` es un carácter, `{a,b}` alternativas. **Sin barra, matchea el
nombre en cualquier carpeta** (`*.py` es "cualquier .py"). Muestra hasta 300.

### `leer_codigo`

- Formato `N→texto`, con el número alineado; la cabecera dice
  `ruta — líneas A-B de N` y el pie `[Sigue: pedí desde=B+1.]`.
- Por default **350 líneas** (`LINEAS_POR_LECTURA`), hasta 700 con `limite`.
  Si el texto pasa de 15.000 caracteres (`TOPE_CARACTERES_LECTURA`) se achica
  un 20% por vuelta mientras tenga más de 20 líneas. Una línea de más de 2.000
  caracteres se corta con "…[línea recortada]".
- **Acoplado al tope de los turnos delegados**: `TOPE_RESULTADO` (16.000) en
  `packages/engine/src/acotar.ts`. Lo que entra a un turno delegado se acota a
  eso, así que mandar más sería mandar algo que llega cortado. `desde` está en
  `ACOTADORES`: es el argumento que ofrece el aviso de recorte.
- Rechaza carpetas (sugiere `buscar_archivos`), binarios (un byte nulo),
  archivos de más de 4 MB ("no es código que se lea entero") y rutas que no
  existen.

### `editar_codigo`

El reemplazo exacto:

1. Pide el arriendo (`conEscritura`) y resuelve la ruta.
2. `buscar` y `reemplazar` tienen que ser texto —"Si el argumento quedó
   cortado, editá un tramo más chico": un modelo que agota `max_tokens` a mitad
   del JSON deja argumentos rotos—; `buscar` no vacío y distinto de
   `reemplazar`. Archivos de hasta 1 MB.
3. **Conserva los finales de línea**: si el archivo es CRLF y `buscar` viene con
   LF, se convierten los dos. Si no, el diff marcaría cada línea como cambiada.
4. **Cero apariciones**: busca un bloque igual **salvo espacios o
   indentación**; si lo hay, lo informa con su línea y **no lo aplica** —en
   Python o YAML la indentación es código—. Si no, sugiere releer: "puede haber
   cambiado desde que lo leíste".
5. **Varias apariciones**: no adivina; nombra las líneas y pide más contexto o
   `todas=true`.
6. Aplica y devuelve **el tramo editado con números** (desde tres líneas antes
   de la primera aparición, lo reemplazado y unas tres después): es lo que el
   agente necesita para la próxima edición sin releer el archivo entero.

### `escribir_codigo`

Crea o reemplaza un archivo entero (hasta 1 MB), creando carpetas. La
descripción empuja a `editar_codigo` para cambios parciales: "reescribir un
archivo entero para cambiar tres líneas es la forma más común de romper lo que
no se miró".

### `aplicar_parche`

Un diff unificado que puede tocar varios archivos. Antes de nada, cada ruta de
las cabeceras `---`/`+++` pasa por `resolverEnWorktree` (nada en `.git`, nada
afuera). Después `git apply --check --recount`: si no aplica, **no se tocó
nada** y se muestra el error. Si aplica, `git apply --recount --stat --apply`
y se devuelve el resumen. Es todo o nada.

### `estado_git`

"Sesión <rama> (base <sha corto>)", los checkpoints de la sesión
(`log baseSha..HEAD`) y el `diff --stat` contra la base; con `ruta` o
`conDiff=true`, el diff (hasta 12.000 caracteres: "[… diff recortado: pedilo
por 'ruta' …]"). Para ver también los archivos nuevos corre antes
`git add -A --intent-to-add`, que **toca el índice** de la sesión aunque la
herramienta sea de lectura (ver [[Control de versiones y publicación]]). Sin
`baseSha` compara contra el árbol vacío de git.

### `revertir_codigo`

- Con `ruta`: si el archivo no está en `HEAD`, era nuevo y se borra; si está,
  `git restore --source=HEAD --staged --worktree`. Ojo: sin commits
  automáticos, `HEAD` es lo que había antes de todo lo que no se commiteó, así
  que vuelve el archivo a su último commit, no al comienzo del turno.
- Con `checkpoint` (sha de 6 a 40 hexadecimales): verifica que sea
  descendiente de la base y no la base misma, y hace `git revert --no-edit`; si
  choca, `revert --abort` y falla. Deja un commit nuevo que lo deshace.

## Casos borde y fallas

- **Memo de lecturas y el `Edit` propio del CLI.** En un turno delegado, una
  lectura idéntica se devuelve como un puntero ("ya hiciste esta misma lectura
  en este turno"). El memo se vacía cuando corre una herramienta del org que no
  es de lectura —editar, ejecutar—, pero **no** cuando el CLI edita con su
  propio `Edit`, que no pasa por el puente. Releer con `leer_codigo`,
  `estado_git` o `mapa_del_codigo` exactamente lo mismo después de un `Edit`
  propio devuelve el puntero a la versión anterior (ver
  [[Turnos delegados a un CLI]]).
- **Argumento cortado**: un `buscar` o `contenido` que no llega como texto se
  rechaza con la sugerencia de editar un tramo más chico.
- **Archivo cambiado entre leer y editar** (lo tocó otro, o el mismo agente con
  otra herramienta): `buscar` no aparece y la respuesta pide releer.
- **`leer_codigo` con `desde` más allá del final**: falla diciendo cuántas
  líneas tiene.
- **Repo con allowlist sin confirmar**: leer y editar funcionan; ejecutar no.

## Qué fijan los tests

`packages/tools/src/codigo/codigo.test.ts`:

- `resolverEnWorktree` no deja salir del árbol, ni entrar a `.git`, ni escapar por un symlink; respeta nombres como `app/[id]/.eslintrc.json`;
- `leer_codigo` numera las líneas y dice cómo seguir; rechaza binarios;
- `editar_codigo` reemplaza un texto exacto y único y devuelve cómo quedó; si aparece varias veces nombra las líneas; un bloque igual salvo indentación se informa y **no** se aplica; conserva CRLF; sin el arriendo no toca nada;
- `aplicar_parche`: un parche que toca `.git` no se aplica; un diff se aplica entero o nada;
- `buscar_codigo` encuentra también en archivos nuevos; `buscar_archivos` entiende `**` y `*` sin cruzar carpetas;
- `extraerSimbolos` por lenguaje; el mapa pone arriba lo que más se usa, entra en su presupuesto y es determinista.

`apps/server/src/ide.test.ts` → "el agente del chat": el Mejorador se crea una
sola vez con todas las herramientas de código.

## Cómo extender

- Una herramienta nueva de código se agrega en `crearHerramientasDeCodigo`, en
  `HERRAMIENTAS_DE_CODIGO` (`codigo-servidor.ts`) y, si escribe, en
  `HERRAMIENTAS_QUE_ESCRIBEN_CODIGO` con `conEscritura` al principio.
- Toda ruta de un modelo, por `resolverEnWorktree`. Todo git, por
  `storage.git`.
- Si cambiás `LINEAS_POR_LECTURA`, mirá `TOPE_RESULTADO`: **están acoplados**.
- Un agente creado antes de la herramienta no la recibe solo: el Mejorador se
  pone al día al crear cada pedido del chat (`crearAgenteDelChat`); los roles de
  plantilla, no (ver [[Chat de IA]]).
- La guía general está en [[Cómo agregar una herramienta]].

## Fuentes

- `packages/tools/src/codigo/index.ts` → `crearHerramientasDeCodigo`, `LINEAS_POR_LECTURA`, `TOPE_CARACTERES_LECTURA`, `TOPE_ARCHIVO_EDITABLE`, `TOPE_BUSQUEDA`, `HERRAMIENTAS_QUE_ESCRIBEN_CODIGO`, `espacioO`, `conEscritura`, `parecidoIgnorandoEspacios`, `carpetaDelComando`
- `packages/tools/src/codigo/rutas.ts` → `resolverEnWorktree`
- `packages/tools/src/codigo/indice.ts` → `mapaDelCodigo`, `extraerSimbolos`, `REGLAS`, `olvidarIndice`
- `packages/tools/src/codigo/glob.ts` → `globARegex`
- `packages/tools/src/codigo/tipos.ts` → `CodigoStorage`, `EspacioDeCodigo`, `ResultadoComando`, `ServicioParaAgente`
- `apps/server/src/codigo-servidor.ts` → `crearCodigoStorage`, `elegirRepo`
- `apps/server/src/runtime.ts` → `registrarCodigoEn`, `registrarHerramientasDeCodigo`
- `packages/engine/src/acotar.ts` → `TOPE_RESULTADO`, `ACOTADORES`

## Ver también

- [[Trabajo con código]]
- [[Arriendo de escritura y resumen de código]]
- [[Comandos y sandbox]]
- [[Referencia de herramientas]]
- [[Herramientas y tool router]]
