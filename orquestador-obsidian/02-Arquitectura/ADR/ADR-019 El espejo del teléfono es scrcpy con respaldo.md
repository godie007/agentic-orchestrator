---
tags: [adr, móvil]
aliases: [scrcpy, Espejo del teléfono, espejo-ws.ts, WebCodecs, screenrecord MJPEG]
---

# ADR-019 El espejo del teléfono es scrcpy con respaldo

**Estado:** aceptada · reemplaza a `screenrecord` → MJPEG como motor principal (queda de respaldo)

## Contexto

Una app de React Native con módulos nativos no arma ni el bundle web, así que la
vista previa de una app móvil es **el teléfono de la persona**, vinculado por QR
de depuración inalámbrica. Hacía falta verlo en vivo dentro del IDE y tocarlo
—y señalar un elemento para mandarlo al chat—.

El primer espejo fue `screenrecord --output-format=h264` pasado a MJPEG por
ffmpeg y servido como `multipart/x-mixed-replace` a un `<img>`: sin dependencias
ni decodificador en el navegador. Después de afinarlo (sin `-fflags nobuffer`,
`-pix_fmt yuvj420p`, `-threads 1`, un AUD cuando el teléfono se calla 12 ms,
el borde del multipart después de cada cuadro) llegó a ~20 cuadros por segundo,
y no daba para más por cuatro causas medidas que se suman:

- el H.264 crudo no dice dónde termina un cuadro, y el AUD por silencio
  **partía cuadros** por Wi-Fi ("corrupt decoded frame");
- recodificar a JPEG limitaba a 20 fps lo que el teléfono daba a 50;
- `adb shell input` arranca una JVM por toque y no sabe arrastrar;
- cada toque como pedido HTTP por el proxy de Vite tenía picos de 61 ms (p90).

## Decisión

El espejo principal es **`scrcpy-server`** —el de `brew install scrcpy`— sobre
**un WebSocket** (`apps/server/src/scrcpy.ts`, `espejo-ws.ts`, `ws.ts`), con el
navegador decodificando por **WebCodecs** y dibujando en un canvas
(`apps/web/src/routes/codigo/Espejo.tsx`).

- El servidor en el teléfono manda **cada paquete de MediaCodec con su tamaño y
  sus banderas** (config, clave): el cuadro llega entero o no llega. La config
  (SPS/PPS) va pegada adelante del cuadro clave, como la espera WebCodecs.
- Por el mismo WebSocket viajan, en orden, el video hacia el navegador y los
  toques (bajar, mover, subir), la rueda y el texto UTF-8 hacia el teléfono
  (llegan las tildes).
- **Una sesión por teléfono, compartida**, que se cierra 5 s después del último
  espectador (`Dispositivos.mirar`); si el navegador se atrasa, se saltan
  cuadros hasta el próximo clave en vez de acumular demora (`TOPE_PENDIENTE`).
- **El WebSocket verifica el `Origin`**: no pasa por CORS, y sin eso cualquier
  página podría manejar el teléfono.
- **La versión del protocolo se lee del `scrcpy` instalado** (`detectarScrcpy`):
  el protocolo es interno y cambia entre versiones.
- **El de `screenrecord` queda de respaldo**, cuando scrcpy no está instalado o
  el navegador no decodifica H.264; y la pantalla se lee con `fetch`, no con un
  `<img>` (un `<img>` cuyo stream termina se queda con el último cuadro sin
  avisar: parecía vivo y estaba congelado).

Medido en el navegador: primer cuadro a 169 ms de empezar a arrastrar (antes
~300 ms, y recién al soltar), ~55 fps con mediana de 18 ms. Lo que queda es el
Wi-Fi.

## Alternativas consideradas

**Seguir afinando `screenrecord`.** Rechazada: las cuatro causas son
estructurales, ningún parámetro las arregla.

**Un emulador.** Rechazada por la persona y por el caso: se quería el teléfono
real, con sus módulos nativos y su build de desarrollo.

**Expo Go por QR.** Rechazada: no trae los módulos nativos de la app.

**La app de escritorio de scrcpy.** Rechazada: abre una ventana aparte y no se
puede señalar ni integrar con el chat del IDE.

## Consecuencias

### A favor

- Fluidez medida del orden de la app nativa, con arrastre visible mientras se
  hace.
- Un solo canal ordenado para video y toques.
- Cambiar de pestaña y volver no rearranca el servidor en el teléfono.

### En contra / lo que se resignó

- **Dependencia instalada**: scrcpy por brew. Sin él, se cae al respaldo más
  lento.
- **Protocolo interno que cambia entre versiones**, con trampas medidas: pedir
  `RESET_VIDEO` antes de que exista la captura tira abajo el servidor (NPE en
  4.1), así que sólo se pide para espectadores que llegan tarde; el socket de
  video va en pausa hasta tener lector (uno que fluye sin oyentes pierde el
  códec).
- **Dos motores de espejo que mantener.**
- **WebCodecs**: un navegador sin decodificador H.264 cae al respaldo.

## Qué lo fija

- `apps/server/src/scrcpy.test.ts` → mensajes de toque, rueda, tecla y texto con
  los bytes que esperan los tests del propio scrcpy; "lee el video: códec, sesión
  y paquetes enteros aunque lleguen en pedazos".
- `apps/server/src/ws.test.ts` → "rechaza un origen que no es el de la app".
- `apps/server/src/dispositivos.test.ts` → "corta JPEG completos y deja el resto
  para el próximo pedazo" (respaldo).

## Fuentes

- `apps/server/src/scrcpy.ts` → `detectarScrcpy`, mensajes de control
- `apps/server/src/espejo-ws.ts` → `TOPE_PENDIENTE`
- `apps/server/src/ws.ts` → verificación de `Origin`
- `apps/server/src/dispositivos.ts` → `Dispositivos.mirar`, `pedirCuadroClave`
- `apps/web/src/routes/codigo/Espejo.tsx`

## Ver también

- [[Espejo del teléfono]] · [[Vinculación del teléfono]] · [[App móvil en el teléfono]]
