---
tags: [adr, producción]
aliases: [Motores de video, ubicarEscenas, construirSonido, Reloj compartido]
---

# ADR-017 Tres motores de video comparten el reloj

**Estado:** aceptada · extiende [[ADR-006 Video en una sola pasada de ffmpeg]]

## Contexto

`export_video` dibuja todo con ffmpeg y libass y sigue siendo lo correcto para
un guion de texto y viñetas. Aparecieron dos pedidos que ese motor no cubre:
láminas maquetadas en HTML (diagramas, tarjetas, cifras) y tutoriales filmados
sobre una app real. La pregunta no era si sumar motores, sino **qué comparten**:
un segundo set de lo mismo dibujado aparte se desincroniza a la primera
corrección —la lección de los íconos del deck—.

## Decisión

Hay **tres motores**, y lo único distinto entre ellos es **cómo se dibuja el
cuadro**:

| Motor | Herramienta | Cuadro |
|---|---|---|
| ASS | `export_video` (`skills/video.ts`) | libass + `gradients`, una sola pasada de ffmpeg |
| Estudio | `export_video_estudio` (`skills/estudio.ts`) | una lámina HTML por escena, revelada por Chrome ([[ADR-012 Usar el Chrome instalado por CDP]]) |
| Clips | `export_video_clips` (`skills/clips.ts`) | clips grabados de una app viva, empalmados a pantalla completa |

Lo que **no puede divergir** vive una sola vez y lo usan los tres:

- **El guion**: `parseGuion` (`skills/guion.ts`) —`#` portada, `##` escena,
  párrafos voz en off, viñetas en pantalla, `**Nombre:**` diálogo—.
- **El reloj**: `ubicarEscenas` coloca cada línea y cada escena a partir de las
  **duraciones medidas del audio**; las pausas (`PAUSA`) y el aire de una escena
  sin habla (3,8 s la portada, 2,4 s el resto) son los mismos. `estimar_duracion`
  usa el mismo parser y las mismas pausas con una tasa medida del sintetizador
  (`PALABRAS_POR_SEGUNDO` = 3,15).
- **La voz**: `crearNarrador` (Kokoro local, `say` de respaldo).
- **La mezcla**: `construirSonido` (`skills/sonido.ts`): cama normalizada a
  `MUSICA.lufs` = −26 y ducking `ratio=4`.
- **Los íconos**: el mismo catálogo (`iconos.ts`) en ASS y en SVG.

Las piezas visuales se atan por **número de archivo**, no por un campo del
guion: `01-portada.html` o `01-….mp4` es la escena 1. En clips, el `00-…` es la
portada y los numerados se atan al **ordinal de las escenas `##` sin contar la
portada** (numerarlas juntas corrió un video entero una escena). La escena sin
pieza propia se dibuja con la plantilla del sistema y se avisa.

En clips, la sincronía voz↔pantalla es **por construcción**: la escena dura lo
que su narración, y el clip se estira clonando su último cuadro o se recorta
(`tpad` **antes** de `trim`; al revés, un clip corto deja entrar el corte
siguiente antes que su voz).

## Alternativas consideradas

**Un solo motor en HTML.** Rechazada: obligaría a tener Chrome para cualquier
video, y el motor ASS no necesita nada instalado.

**Motores independientes, cada uno con su parser y su reloj.** Rechazada: el
mismo guion daría duraciones distintas según el motor, y un arreglo del parser
(el diálogo sin renglones en blanco, la marca de ícono suelta) habría que
hacerlo tres veces.

**Atar piezas por un campo del guion.** Rechazada: pedirle al guion que nombre
archivos es pedirle que mantenga dos listas sincronizadas.

## Consecuencias

### A favor

- Un arreglo en el guion, la voz o la mezcla llega a los tres motores.
- El mismo guion también es un deck (`export_slides`): no pueden decir cosas
  distintas.
- `estimar_duracion` responde sin renderizar, con el mismo reloj.

### En contra / lo que se resignó

- **El reloj manda sobre la imagen**: un clip más largo que su narración se
  corta; uno más corto se congela en su último cuadro.
- **Cambiar el reloj es cambiar tres videos**: toda modificación de
  `ubicarEscenas` hay que revisarla contra los tres motores.
- **El motor de clips no tiene encadenado**: el pasaje es un corte (en un
  tutorial el corte es el lenguaje).

## Qué lo fija

- `packages/tools/src/skills/guion.test.ts` (parser, íconos, música, reparto de
  voces, deck).
- `packages/tools/src/skills/estudio.test.ts` → `atarLaminas`, `planificar`,
  `construirSonido` ("el aresample va DESPUÉS del loudnorm…", "la cama se aparta
  sola cuando alguien habla").
- `packages/tools/src/skills/clips.test.ts` → `atarClips` ("el 00 es portada, no
  la escena 1"), `planificarCortes`, `filtroDeEscena` ("estira primero y corta
  después").

## Fuentes

- `packages/tools/src/skills/guion.ts` → `parseGuion`, `ubicarEscenas`,
  `estimarDuracion`, `PALABRAS_POR_SEGUNDO`
- `packages/tools/src/skills/sonido.ts` → `construirSonido`, `MUSICA`, `DUCKING`
- `packages/tools/src/skills/narracion.ts` → `crearNarrador`
- `packages/tools/src/skills/video.ts`, `estudio.ts`, `clips.ts`, `slides.ts`

## Ver también

- [[Producción audiovisual]] · [[Guion como línea de tiempo]] · [[Motor de video ASS]]
- [[Motor estudio de láminas HTML]] · [[Motor de clips grabados]] · [[Música y narración]]
