---
tags: [capacidad, producción]
aliases: [vozSchema, marcaSchema, pronunciacion, unaSolaVoz, pronunciar, Lexico, Logo, marca/logo.png, Paleta, rotulos]
---

# Voz y marca de la empresa

Cómo suena y cómo se ve una empresa cuando produce un video **es un dato de la
empresa, no del guion ni del agente**: el nombre se pronuncia igual en todos sus
videos, y los rótulos llevan sus colores aunque cambie quien filma. Por eso viven
en `Company` (`packages/shared/src/schema.ts`) y las habilidades los leen de
`ctx.workspace.company` en cada exportación.

## `vozSchema`

```ts
voz: {
  unaSolaVoz: boolean,                 // default false
  pronunciacion: Record<string, string> // default {}
}
```

Default de la empresa: `{ unaSolaVoz: false, pronunciacion: {} }`. Lo usan los
tres motores (`export_video`, `export_video_estudio`, `export_video_clips`), que
se lo pasan al narrador como `unaSolaVoz` y `lexico`.

### `pronunciacion`: lo que se dice no es lo que se escribe

Un motor de voz lee una marca con las reglas del castellano y la pronuncia mal
—"Codytion" sale "codi-ti-ón"—. Corregirlo escribiendo mal el nombre en el guion
lo rompería en pantalla: "codishon" sería una falta de ortografía. Por eso el
léxico se aplica **sólo al texto que va al sintetizador**, nunca al que se ve.

`packages/tools/src/skills/narracion.ts` → `pronunciar(texto, lexico)`:

- sin distinguir mayúsculas (`CODYTION` también);
- **sólo palabra entera**, delimitada a mano con "lo que no es letra ni dígito"
  (`\p{L}\p{N}` con la bandera `u`), porque `\b` no sirve con acentos ni con
  siglas pegadas a un signo;
- respeta lo que había antes (un `¿`, un espacio).

> [!danger] Sin corte de palabra, una sigla rompe cualquier texto
> Una regla para `IA` reescribía **"familia"** por dentro y la voz decía
> "famili a".

Ejemplo real (`scripts/seed-estudio-codytion.ts`): `Codytion → códishon`,
`IA → i a`, `IoT → i o té`, `API → a pe i`, `software → sóftwer`. En INSPIA:
`INSPIA → inspia`, `NC → ene ce`, `kV → kilovoltios`, `PDF → pe de efe`.

### `unaSolaVoz`: la empresa, no un elenco

Con `true`, todos los personajes suenan con la voz del narrador. Varias voces en
una pieza institucional suenan a **reparto de actores**: la pieza la dice la
empresa. Con `false` (default), cada personaje de un diálogo recibe una voz
distinta: una conversación en la que los dos suenan igual es un monólogo con
guiones. El reparto está en [[Música y narración]].

## `marcaSchema`

```ts
marca: {
  acento: "#rrggbb",  // default #40a0f8
  panel:  "#rrggbb",  // default #232f4d
  rotulos: boolean    // default false
}
```

Validado con regex `^#[0-9a-fA-F]{6}$`. Los defaults son los del kit, así una
empresa que no la configura se ve como siempre.

**Hoy sólo la usa el [[Motor de clips grabados]]**: `rotulos` prende el título
animado de cada escena, `acento` es el color de su barra y `panel` el fondo que lo
hace legible. Un rótulo con el azul del kit sobre el video de una empresa que usa
naranja se ve como una plantilla.

`rotulos` viene apagado porque, cuando se filma una aplicación, la pantalla ya trae
sus propios títulos y el rótulo compite con ellos. Se prende cuando el visual no
se explica solo.

> [!warning] La paleta de los motores ASS y estudio está fija
> `COLOR` en `video.ts` y `PALETA` en `tema.ts` están escritos en el código:
> fondo grafito `#0a0e1a`, acento `#40a0f8`, realce `#3ee8b4`, violeta
> `#5058e8`, panel `#232f4d`. **Salen del logo de Codytion** y se usan para toda
> empresa: `marca` no los cambia. Una empresa con otra identidad hoy sólo la
> recupera en los rótulos del motor de clips o programando sus láminas.

### Por qué la paleta sale del logo y no del sitio

El sitio de Codytion usa un azul plano y un ámbar de botón; el logo es un lazo de
turquesa, azul y violeta, y **eso** es lo que hace reconocible a la marca. Los tres
colores se muestrearon del archivo: violeta `#5058e8` (40 % del logo), turquesa
`#40f8c0` (26 %) y azul `#40a0f8` (15 %). El ámbar quedó afuera a propósito: con
él, la pieza se parecía a cualquier presentación oscura con un botón amarillo. (El
realce que usa el código es `#3ee8b4`, un turquesa apenas más apagado.)

## El logo

**Una ruta fija, no una opción de configuración**: `marca/logo.png` dentro del
directorio de salida de la empresa (`data/proyectos/<Nombre>/salida/marca/logo.png`).
Es un archivo de la empresa como cualquier otro y quien lo cambia no toca un
`.env`. Si está, firma la pieza; si no, no.

> [!note] Se copia a mano
> No hay endpoint de subida de archivos: el logo (igual que fotos y música) se
> deja en la carpeta desde el sistema de archivos. La limpieza de la salida lo
> conserva porque lo trajo una persona, no un agente.

**Va chico y quieto.** No se recorta ni se le hace el acercamiento lento de las
fotos: un logo deformado es peor que ningún logo. Se escala entero con
`scale=-2:<alto>` (conserva la proporción con ancho par) y sólo entra y sale con
fundido.

| Motor | Portada | Resto de las escenas |
|---|---|---|
| ASS (`MARCA`) | x 180, y 250, 190 px de alto | arriba a la derecha: x = `W-w-180`, y 128, 62 px |
| estudio (plantilla) | `.marca` estática de 190 px, sobre el título | `.marca` absoluta, derecha 180 px, arriba 92 px, 62 px |
| clips | no pone logo: la marca va en el clip `00` de portada | — |
| deck | ver [[Deck de slides]] | |

La posición en el motor ASS es una **expresión de ffmpeg** (`W-w-180`) y no un
número: el logo se ancla al borde derecho sin que nadie mida el archivo. Se pone
una vez por escena, con la ventana de cada una.

## El idioma de la pieza

El idioma y el registro de lo que se lee y se escucha **también son de la
empresa**: viven en su contexto (`company.context`), como la pronunciación, y el
guion ya viene escrito en ellos. Codytion e INSPIA hablan castellano de Colombia,
de usted, y sus seeds prohíben el voseo en una política propia.

Las **instrucciones** de los roles del estudio y la guía del kit van en inglés,
porque un modelo sigue una especificación larga con más precisión en el idioma en
el que se entrenó mayoritariamente. Cada una abre declarando el idioma de salida:
sin esa línea, una instrucción en inglés arrastra la respuesta al inglés y el
video termina hablando en otro idioma. Los nombres de clase del kit siguen en
castellano: son la API. Ver [[Motor estudio de láminas HTML]].

## Cómo se configura

No hay pantalla para voz ni marca. Se cargan:

- en los seeds (`company.voz`, `company.marca`), o
- con `PATCH /api/companies/:id` y un cuerpo como
  `{"voz": {"unaSolaVoz": true, "pronunciacion": {"Codytion": "códishon"}}}`.
  El PATCH mezcla **a primer nivel**: `voz` se reemplaza entera, así que hay que
  mandar las dos claves. Ver [[Referencia de API]].

Filas viejas sin `voz` o `marca` toman los defaults del esquema al parsearse.

## Qué fijan los tests

`packages/tools/src/skills/guion.test.ts` → "cómo suena la marca": reemplaza el
nombre sin importar mayúsculas; sólo toca la palabra entera ("familia" queda
intacta); una palabra pegada a un signo también se pronuncia; sin léxico el texto
pasa intacto; con una sola voz, los personajes suenan igual que el narrador.

## Fuentes

- `packages/shared/src/schema.ts` → `vozSchema`, `marcaSchema`, `companySchema`
- `packages/tools/src/skills/narracion.ts` → `pronunciar`, `Lexico`, `repartir`
- `packages/tools/src/skills/video.ts` → `COLOR`, `MARCA`, `ubicarImagenes`, `filtroImagen`
- `packages/tools/src/skills/tema.ts` → `PALETA`, `.marca`, `laminaDeEscena`
- `packages/tools/src/skills/clips.ts` → `filtroDeRotulo`
- `packages/tools/src/skills/index.ts` → `LOGO`, `crearVideo`, `crearVideoEstudio`, `crearVideoClips`
- `apps/server/src/routes.ts` → `PATCH /api/companies/:id`

## Ver también

- [[Música y narración]]
- [[Producción audiovisual]]
- [[Motor de clips grabados]]
- [[Modelo de dominio]]
- [[Referencia de esquemas]]
