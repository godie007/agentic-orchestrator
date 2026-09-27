---
tags: [capacidad, producción]
aliases: [Íconos, Visuales, iconos.ts, visuales.ts, iconoAss, iconoSvg, separarIcono, ICONOS_DISPONIBLES, visualAss, visualSvg, trazoAAss, VISUALES_DISPONIBLES, ASS, SVG]
---

# Íconos y visuales vectoriales

> Los íconos se dibujan, no se instalan. Y un diagrama no es una foto de peor
> calidad.

Dos catálogos dibujados en código que comparten el video y el deck: **20 íconos**
(`packages/tools/src/skills/iconos.ts`) que se ponen con `:nombre:` al principio
de una viñeta o de un `##`, y **8 visuales** (`packages/tools/src/skills/visuales.ts`)
que se ponen como imagen con `![lo que muestra](visual:nombre)`. Cada dibujo se
define **una vez** en una caja de 100×100 y se emite en los dos lenguajes: trazos
de ASS para el video y SVG para el deck y las láminas. Un segundo set dibujado
aparte se desincroniza a la primera corrección. No hay assets que empaquetar,
escalan sin perder nitidez, no dependen de ningún proveedor y salen siempre en la
paleta de la marca.

## Por qué dibujados

- **Emojis, no.** libass los dibuja en monocromo o los saltea según la fuente
  instalada: un video que en una máquina muestra un cohete y en otra un cuadrado
  vacío no es una salida confiable. En el PDF, además, las fuentes estándar los
  imprimen como mojibake (ver [[Documentos Word y PDF]]).
- **Un catálogo corto, a propósito.** Un set de doscientos obliga al agente a
  elegir, y elige mal. Los nombres están en castellano porque los escribe el
  agente dentro del guion.
- **Un diagrama en vez de una foto.** Cuando lo que hay que mostrar es de dónde
  sale un dato y a dónde llega, una foto de gente en una oficina no dice nada y
  un diagrama lo dice todo. Además no cuesta nada y no envejece como una foto de
  banco.

## Íconos

### Sintaxis

```markdown
## :grafico: Lo que medimos
- :chequeo: Stock por sucursal
- :plazo: Entrega en 12 semanas

## Qué hacemos

:objetivo:

Lo que dice la voz en off.
```

- Al principio de un `##` → ícono de la escena; el título queda sin la marca.
- Al principio de una viñeta, numerada o fila de tabla → ícono de esa viñeta.
- **Solo en su renglón** → ícono de la escena (si todavía no tenía uno). Los
  modelos lo escriben así, debajo del título; como un párrafo es voz en off, sin
  esta regla el video decía ":objetivo:" en el medio.
- La marca es `:` + 2 a 24 letras (acentos, `_` y `-` permitidos, sin dígitos) +
  `:`, al principio del texto (`separarIcono`). Se normaliza sin tildes ni
  mayúsculas.

> [!warning] Una marca desconocida queda a la vista, a propósito
> `:crecimiiento:` no se traga: la viñeta sale con el texto
> ":crecimiiento: Subió" y la viñeta cuadrada de siempre. Y sola en su renglón,
> **se dice** en voz alta. Es la única forma de que el agente vea su error de
> tipeo: una viñeta sin ícono la daría por buena.

### El catálogo

`ICONOS_DISPONIBLES` es la lista ordenada de nombres; se le muestra al agente en
la descripción de `export_video`.

| Nombre | Qué dibuja | Para qué | Sinónimos que resuelven a él |
|---|---|---|---|
| `alerta` | Triángulo con el signo calado | Riesgo | `riesgo`, `advertencia`, `peligro` |
| `calendario` | Hoja de calendario con cuatro días | Fecha, plazo, misión programada | `fecha`, `agenda`, `cronograma` |
| `candado` | Arco sobre el cuerpo, con cerradura calada | Reservado, aprobado | `privado`, `aprobado` |
| `chequeo` | Un tilde | Lo hecho, lo que cumple | `ok`, `listo`, `hecho`, `check` |
| `cohete` | Cohete con ventanilla y aletas | Lanzamiento, arranque | `lanzamiento`, `inicio` |
| `conversacion` | Globo de diálogo | Lo que alguien dice | `dialogo`, `charla` |
| `correo` | Sobre | Aviso, correo | `mail`, `mensaje` |
| `dinero` | Billete con círculo y bordes calados | Plata, costo, ahorro | `plata`, `costo`, `precio`, `ahorro` |
| `documento` | Hoja con esquina doblada y renglones | Informe | `informe`, `archivo`, `contrato` |
| `engranaje` | Rueda con cuatro dientes y centro calado | Proceso, sistema | `proceso`, `sistema`, `config` |
| `equipo` | Dos personas | Equipo, área, reunión | `gente`, `personas` |
| `escudo` | Escudo con un tilde adentro | Seguridad, cumplimiento, garantía | `seguridad`, `calidad` |
| `grafico` | Tres barras que suben | Un resultado que se mide | `datos`, `metricas`, `resultados` |
| `idea` | Lamparita | Idea, propuesta | `innovacion`, `propuesta` |
| `lupa` | Lupa | Análisis, auditoría | `analisis`, `auditoria`, `revision` |
| `objetivo` | Diana de tres anillos | Meta | `meta`, `blanco` |
| `persona` | Cabeza y hombros | Cliente, usuario | `cliente`, `usuario` |
| `rayo` | Rayo | Velocidad, urgencia | `energia`, `rapido`, `urgente` |
| `reloj` | Esfera con dos agujas | Tiempo, plazo | `tiempo`, `plazo` |
| `tendencia` | Flecha en diagonal hacia arriba | Crecimiento | `crecimiento`, `ventas` |

Los sinónimos (`SINONIMOS`, 51 entradas) existen porque el agente escribe el que
se le ocurre: un guion que pide `:tiempo:` y no recibe nada deja la viñeta
desalineada respecto de las otras. Los sinónimos no se listan al agente.

### Cómo se dibuja uno

- Coordenadas en una caja de **100×100**, eje Y hacia abajo. Tres primitivas:
  `circulo` (cuatro curvas de Bézier con la constante `K = 0.5523`), `rect` y
  `poli`. Cada ícono es una cadena de comandos ASS `m` / `l` / `b`.
- Números con dos decimales como mucho (`n`): el archivo ASS no se infla.

> [!danger] Un agujero se dibuja con el contorno invertido
> ASS rellena por regla **non-zero**: un contorno en sentido contrario resta en
> vez de sumar. `circulo(…, -1)` y `rect(…, -1)` invierten el sentido. Sin eso,
> un candado es una mancha con forma de candado.

> [!warning] Ojo con superponer contornos
> En el candado el arco va **arriba** del cuerpo: si se superponen, el hueco del
> arco perfora la tapa y el candado termina pareciendo un bolso.

### Cómo sale en cada medio

| Medio | Función | Tamaño y color |
|---|---|---|
| Video ASS | `iconoAss(nombre, tamaño)`: escala sólo los números (los comandos son letras) | Ícono de escena 54 px, **sobre** el título, en el estilo `Realce` (turquesa): al lado del título obligaba a sangrar. Viñeta 38 px en `Vineta` (azul); el texto se corre a 68 px en vez de 48 |
| Deck | `iconoSvg(nombre)` dentro de `<svg viewBox="0 0 100 100">` con `fill="currentColor"` | Escena: `.icono-escena`; viñeta: `.icono-bala` |
| Láminas del estudio | `iconoSvg` en la plantilla `tema.ts` (`viñeta`) | 46×46 en el acento del kit; si no existe, el rombo de siempre |
| Word / PDF | No se procesan | La marca queda como texto literal |

`iconoSvg` traduce `m`→`M`, `l`→`L`, `b`→`C` y cierra cada contorno con `Z`
(ASS cierra solo; SVG no). **Las dos rellenan por regla non-zero**, así que los
agujeros siguen siendo agujeros sin tocar nada. Un nombre que no está devuelve
`null` en las dos funciones y quien llama dibuja la viñeta de siempre: un ícono
mal escrito **degrada, no rompe** la escena.

## Visuales

### Sintaxis

```markdown
## Cómo funciona

![Del mensaje al registro](visual:flujo)

## El primer contacto

![La especialista llama](visual:llamada|Cuénteme cómo cierra el día)
```

- Va sola en su renglón, como cualquier imagen. El `alt` es el epígrafe en un
  documento; el visual trae además su propia `descripcion` para el
  `aria-label` del SVG.
- Lo que va **después del `|`** es lo que dice el personaje. Lo escribe el guion
  y no el catálogo porque cambia con cada pieza: el mismo escenario de bodega
  sirve para dos campañas si la frase la pone el guion.
- El nombre se compara en minúsculas, sin recortar tildes (`nombreDeVisual`).
  Un nombre desconocido **no** se toma como visual: queda como una ruta de
  archivo que no existe y termina en un aviso de imagen que no apareció.

### El catálogo

`VISUALES_DISPONIBLES` existe pero **no se usa en ninguna descripción de
herramienta**: un agente sólo conoce la sintaxis `visual:` si su prompt se la
cuenta (el seed de INSPIA lo hace).

| Nombre | Qué muestra | Acepta `\|frase` |
|---|---|---|
| `chat` | Un chat de trabajo: encabezado "Reporte del día", un audio con su onda, una foto de planilla, "Listo, ya quedó", "Van 240 bultos" y la caja de escribir | No |
| `flujo` | Del mensaje al sistema y a cuatro salidas: "Mensaje (audio · foto · texto)" → "El sistema entiende y clasifica" → Planilla, Correo, Agenda, Aviso | No |
| `datos` | Tres tarjetas de cifra: "10+ años construyendo software", "3 países", "20+ proyectos entregados" | No |
| `monitoreo` | Un tablero "Operación" con luz verde, una línea que sube y tres cajas: Nube en línea, Respaldos al día, Alertas activas | No |
| `contacto` | Ficha de quien atiende el primer contacto: iniciales, nombre, profesión y correo | No |
| `bodega` | Una operaria con el celular frente a una estantería con cajas, y un globo | Sí — default "Mando el reporte por audio" |
| `escritorio` | Un gerente sentado detrás del escritorio con una notebook, una ventana y una planta, y un globo | Sí — default "Ya sé lo que pasó ayer" |
| `llamada` | Una especialista con auricular y micrófono, y un globo | Sí — default "Cuénteme cómo cierra el día" |

> [!warning] Tres visuales traen datos fijos de Codytion
> `flujo` dice "El sistema" y no el nombre de una empresa **porque ya pasó**: un
> video de INSPIA salió con "Codytion" dibujado en el medio del diagrama. Pero
> `datos` (años, países, proyectos) y `contacto` (nombre, profesión y correo de
> una persona de Codytion) siguen con valores fijos en el código, y el catálogo
> lo comparten todas las empresas: en otra marca muestran datos que no son suyos.

### Cómo está hecho uno

Un `Visual` es `{ descripcion, construir(texto) → Pieza[] }`. Es una función y
no una lista fija porque las personas necesitan lo que dicen: un personaje con
un globo vacío es un maniquí.

| Pieza | Campos |
|---|---|
| `trazo` | `d` en SVG con **sólo** `M`, `L`, `C`, `Z` absolutos; `color`; `opacidad` |
| `rect` | `x`, `y`, `ancho`, `alto`, `radio`, `color`, `opacidad` |
| `linea` | `x1`, `y1`, `x2`, `y2`, `color` (grosor 0,7) |
| `circulo` | `cx`, `cy`, `r`, `color`, `opacidad` |
| `texto` | `x`, `y` (línea de base), `texto`, `cuerpo`, `color`, `centrado`, `peso` |

Los colores son **simbólicos** (`Tinte`) y cada medio los resuelve con su
paleta: `acento`, `realce`, `violeta`, `tinta`, `tenue`, `panel`, `linea`,
`piel`, `pielAlt`, `pelo`, `ropa`, `ropaAlt`.

| Tinte | Video (`video.ts`, hex) | Deck (`slides.ts`, OKLCH) |
|---|---|---|
| `acento` | `#40a0f8` | `oklch(70% 0.14 250)` |
| `realce` | `#3ee8b4` | `oklch(85% 0.16 168)` |
| `violeta` | `#5058e8` | `oklch(55% 0.22 274)` |
| `tinta` | `#f8fafc` | `oklch(97% 0.006 250)` |
| `tenue` | `#94a3b8` | `oklch(72% 0.025 255)` |
| `panel` | `#232f4d` | `oklch(26% 0.042 268)` |
| `linea` | `#1e293b` | `oklch(30% 0.03 265)` |
| `piel` / `pielAlt` | `#e3b18a` / `#b8815a` | `oklch(78% 0.075 62)` / `oklch(62% 0.075 52)` |
| `pelo` | `#3a2b21` | `oklch(32% 0.045 42)` |
| `ropa` / `ropaAlt` | `#2f8fb5` / `#4a5590` | `oklch(58% 0.16 205)` / `oklch(45% 0.09 268)` |

### Las personas se dibujan con curvas

`persona()` arma una figura de medio cuerpo sobre una caja de 100 de alto y la
escala: una persona chica en una esquina y otra grande en el centro son la misma
persona. Torso con hombros curvos (sin la curva de arriba parece un buzo
colgado), cuello, escote en V, cabeza **ovalada** (un círculo perfecto se lee
como emoji), tres peinados (`corto`, `recogido` con rodete, `ondulado`) y un
brazo que sube hacia la cara con la mano en tono piel (sin ella el brazo termina
en un muñón de tela). `mira` espeja el brazo.

- **Con curvas y no con cajas:** un cuerpo hecho de rectángulos se lee como un
  muñeco de bloques, y una lámina de venta con muñecos de bloques se ve como una
  plantilla gratis.
- **Caras sin rasgos**, a propósito: un ojo mal puesto por un generador arruina
  la figura.
- **Dos tonos de piel, no una paleta**: un ilustrador puede matizar, un
  generador no, y media docena elegida por un programa termina en un reparto que
  parece un folleto. Dos tonos cálidos y desaturados: sobre fondo azul oscuro una
  piel saturada se lee como plástico.

> [!warning] Al mover una figura, mové los props
> El teléfono de `bodega` y la vincha y el micrófono de `llamada` están en
> **coordenadas absolutas** de la caja, no colgados de la persona: una persona
> que se corre seis unidades deja el teléfono flotando en el aire.

### El globo calcula su propio corte

`globo(x, y, ancho, frase, desde)`: cuerpo 5, y los caracteres por renglón salen
del ancho (`(ancho − 12) / (cuerpo × 0,5)`, mínimo 8), suponiendo que un
carácter mide medio cuerpo. Pasarle un número de caracteres a ojo es lo que
hacía que la frase se saliera por el costado. Hasta **3 renglones**; lo que no
entra se corta con "…": un globo que crece hasta taparle la cara al personaje es
peor que una frase recortada. La punta apunta a quien habla.

### Cómo sale en cada medio

| Medio | Función | Dónde va |
|---|---|---|
| Deck | `visualSvg(spec, TINTES)` → `<svg class="visual" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">` | En la columna de la figura (`figure.lienzo`), entero. En la portada se ignora. Sólo el primero de la escena. |
| Video ASS | `visualAss(spec, x0, y0, lado)` → lista de `PiezaAss` | Un cuadrado centrado en el panel derecho (`PANEL` 644×620 en x=1096, y=214), con entrada de 500 ms. Todos los visuales de la escena se superponen en el mismo panel. |
| Estudio de láminas / clips | — | No los dibujan. |
| Word / PDF | — | Queda el epígrafe. |

**ASS no sabe poner una palabra dentro de una forma**, así que `visualAss`
devuelve el dibujo **despiezado**: primero las formas (`tipo: "forma"`, trazo
`m/l/b` con su posición en píxeles), después los rótulos (`tipo: "texto"`), y
quien renderiza los apila en ese orden para que el texto quede encima. Cada
tinte es un estilo ASS propio (`TinteAcento`…), así los eventos no se ensucian
con `\c`; la opacidad se expresa como transparencia ASS, que va al revés
(0 es opaco).

> [!danger] El ancla del texto no es la misma en los dos medios
> En SVG la `y` del texto es la **línea de base**; en ASS con alineación superior
> es el **techo**. `visualAss` resta un cuerpo (`y − cuerpo × k`): sin eso los
> rótulos caen un renglón más abajo que su caja.

### `trazoAAss`: por qué sólo cuatro comandos

`trazoAAss(d, escala, dx, dy)` traduce `M`/`L`/`C` a `m`/`l`/`b`, descarta la
`Z` (ASS cierra cada contorno solo) y escala. La restricción a cuatro comandos
absolutos **no es pereza**: es lo que permite convertir el mismo trazo sin
escribir un intérprete de SVG. En cuanto entra un arco o una curva cuadrática
habría que escribirlo. Y si sobrevive una `M` o una `C`, **libass descarta el
dibujo entero** y la persona no aparece. Los rectángulos, líneas y círculos se
convierten aparte (una línea es un polígono de cuatro puntos de grosor mínimo
2 px).

## Compatibilidad entre los dos lenguajes

| | ASS (video) | SVG (deck, láminas) |
|---|---|---|
| Comandos | `m` `l` `b` | `M` `L` `C` `Z` |
| Cierre de contorno | Implícito | `Z` explícito |
| Relleno | non-zero | non-zero (default) |
| Agujeros | Contorno invertido | Contorno invertido |
| Ancla del texto | Techo | Línea de base |
| Texto dentro de una forma | No: va aparte, encima | Sí |
| Color | Un estilo por tinte | `fill` con la paleta del medio |

## Qué fijan los tests

`packages/tools/src/skills/guion.test.ts`:

- "una viñeta con :nombre: se queda con el ícono y suelta la marca"; sin ícono
  la viñeta existe igual.
- "un sinónimo resuelve al mismo ícono" (`:plazo:` → `reloj`).
- "un ícono que no existe deja la marca a la vista".
- "una marca de ícono sola en su renglón no la dice la voz en off"; "una marca
  desconocida sola sí se dice".
- "el ícono del título de escena no queda pegado al texto de la placa".
- "el trazo se escala al tamaño pedido" (el doble de tamaño, el doble de
  coordenadas) y un nombre inexistente da `null`.
- "un visual con personaje dice lo que le escribe el guion" y dibuja trazos.
- "un nombre que no existe no se toma por visual".
- "el trazo de SVG se traduce a ASS sin dejar comandos de SVG" (sólo
  `m`, `l`, `b`, dígitos) y el globo llega como texto aparte.
- "una frase larga se corta y no se sale del globo" (aparece "…").
- "una lámina por escena, con el mismo ícono que el video" (deck).

## Cómo agregar uno

- **Ícono:** una entrada en `CATALOGO` de `iconos.ts` con `circulo`, `rect` y
  `poli` en la caja de 100×100; los huecos con `sentido: -1`. Sumá sinónimos si
  hay palabras obvias. Aparece solo en la descripción de `export_video`.
  Revisalo en los dos medios: un contorno que se superpone cambia la figura.
- **Visual:** una entrada en `CATALOGO` de `visuales.ts`, con `fijo(...)` o con
  `construir(frase)`. Trazos libres sólo con `M`, `L`, `C`, `Z` absolutos;
  colores sólo con `Tinte`; nada de nombres propios de una empresa. Si usás un
  tinte nuevo, agregalo a `Tinte`, a `TINTES` del deck y a `ESTILO_DE_TINTE` y
  los estilos de `video.ts`.

## Fuentes

- `packages/tools/src/skills/iconos.ts` → `CATALOGO`, `SINONIMOS`, `ICONOS_DISPONIBLES`, `separarIcono`, `iconoSvg`, `iconoAss`, `circulo`, `rect`, `poli`, `K`
- `packages/tools/src/skills/visuales.ts` → `CATALOGO`, `VISUALES_DISPONIBLES`, `Pieza`, `Tinte`, `Visual`, `persona`, `globo`, `renglones`, `nombreDeVisual`, `visualDe`, `visualSvg`, `visualAss`, `trazoAAss`
- `packages/tools/src/skills/guion.ts` → `parseGuion`, `comoImagen`
- `packages/tools/src/skills/video.ts` → `componerAss`, `COLOR`, `ESTILO_DE_TINTE`, `PANEL`
- `packages/tools/src/skills/slides.ts` → `TINTES`, `icono`; `packages/tools/src/skills/tema.ts` → `viñeta`
- `packages/tools/src/skills/index.ts` → descripción de `crearVideo`
- Test: `packages/tools/src/skills/guion.test.ts`

## Ver también

- [[Deck de slides]] · [[Motor de video ASS]] · [[Motor estudio de láminas HTML]]
- [[Guion como línea de tiempo]] · [[Producción audiovisual]] · [[Habilidades de producción]]
- [[ADR-006 Video en una sola pasada de ffmpeg]]
