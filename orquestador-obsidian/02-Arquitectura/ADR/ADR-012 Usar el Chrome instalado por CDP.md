---
tags: [adr, producción]
aliases: [Chrome por CDP, chrome.ts, buscarChrome, abrirRevelado, abrirGrabacion, ORQ_CHROME]
---

# ADR-012 Usar el Chrome instalado por CDP

**Estado:** aceptada · acota a [[ADR-006 Video en una sola pasada de ffmpeg]] (que rechazaba un navegador para seis placas de texto)

## Contexto

[[ADR-006 Video en una sola pasada de ffmpeg]] descartó un navegador headless:
cambiar 150 MB de dependencia por un `<div>` era mal negocio para maquetar seis
placas de texto que libass ya sabe dibujar. Esa cuenta cambió con dos
necesidades nuevas:

1. **Láminas que el ASS no puede maquetar**: un diagrama que se dibuja solo,
   una retícula de tarjetas, una cifra grande con su gráfico. Y sobre todo,
   **HTML es el lenguaje que un agente sabe programar**: una lámina se le puede
   encargar a un rol que escribe código, que la prueba y la corrige.
2. **Filmar software de verdad**: un tutorial se mira mejor viendo la app
   moverse que leyendo viñetas sobre ella.

Las dos piden un navegador. La pregunta era cuál y cómo.

## Decisión

**No se instala ningún navegador.** Se maneja **el Chrome que ya está en la
máquina** por su protocolo de depuración (CDP), con el `WebSocket` nativo de
Node: cero dependencias nuevas, la misma regla que ffmpeg, Kokoro y `say`.

- `buscarChrome` prueba, en orden, una ruta explícita, `ORQ_CHROME` y una lista
  de candidatos (`CANDIDATOS`: Chrome, Chromium y Edge en macOS;
  `google-chrome` y `chromium` en Linux).
- Se lanza `--headless=new --remote-debugging-port=0 --user-data-dir=<perfil>`
  y se habla CDP por WebSocket.
- **Si no hay navegador, las habilidades que lo necesitan no se registran**
  (`createSkillTools` → `hayNavegador`): `export_video_estudio`,
  `revisar_lamina`, `grabar_clip`, `explorar_pantalla` y `export_video_clips`.
  Ofrecer una herramienta que siempre falla hace gastar turnos intentándola, y
  `export_video` filma el mismo guion sin navegador.
- Todo lo que sale de acá lleva **corte por tiempo** (`CORTE`: arranque 20 s,
  comando 30 s, carga 20 s): un navegador que no arranca cuelga el render
  entero, igual que un endpoint mudo.

Dos modos de uso con reglas distintas:

| Modo | Para qué | Cómo se obtiene el tiempo |
|---|---|---|
| **Revelado** (`abrirRevelado`) | láminas HTML del motor estudio | **se calcula**: se pausan todas las animaciones y se les fija el tiempo cuadro por cuadro; resultado idéntico en cualquier máquina |
| **Grabación** (`abrirGrabacion`) | clips de una app viva | **se graba** con `Page.startScreencast`: cada repintado llega con su instante, así el clip dura lo que duró la interacción |

Del revelado salen tres reglas del kit de láminas que no son estéticas: **nada
de bucles infinitos** (no se pueden filmar sin capturar el video entero), **nada
de `<animate>` de SVG** (SMIL no aparece en `getAnimations()`, así que no se
puede adelantar) y **nada de pedidos a la red**. Se captura **sólo la entrada**
(hasta `ANIMACION_MAXIMA`, 8 s): una lámina entra y se queda quieta, y lo que
evita que se vea muerta es que es transparente y el fondo lo sigue moviendo
ffmpeg por detrás. El lienzo es el del video (`LIENZO`: 1920×1080 a 30 cuadros).

## Alternativas consideradas

**Puppeteer o Playwright como dependencia.** Rechazada: bajan su propio
Chromium (el orden de los 150 MB que ya se había descartado) y agregan una
superficie de dependencia que no compra nada que CDP a mano no dé.

**El MCP de Playwright para todo.** Fue lo primero para reconocer pantallas y
se reemplazó: es **otro** Chrome, con **otra** sesión y **otro** tamaño, así que
lo verificado no era lo que veía la cámara, y cada búsqueda devolvía media
página al contexto. `explorar_pantalla` usa la misma `sesion`, el mismo lienzo
y el mismo motor de acciones que `grabar_clip`. Playwright queda para lo que el
motor de clips no hace: crear datos de demo y leer consola y red.

**Maquetar todo en ASS.** Rechazada para el motor estudio: diagramas, grillas y
gráficos no se maquetan en ASS, y un agente no programa ASS con la soltura con
que programa HTML. El motor ASS sigue siendo el correcto para un guion de texto
y viñetas.

**Grabar la pantalla en tiempo real también para las láminas.** Rechazada: el
resultado depende de la velocidad de la máquina (en una lenta, la animación sale
a tirones). Para una app viva, en cambio, no hay alternativa: el tiempo es el de
la app.

## Consecuencias

### A favor

- Cero dependencias nuevas y ningún binario en `node_modules`.
- El cuadro de una lámina es determinista: el mismo HTML da el mismo video.
- Las láminas se le encargan a un rol que programa, que las revisa con
  `revisar_lamina` antes de filmar.
- La sesión del navegador **se reusa entre tomas** (`grabar_clip` con `sesion`):
  medido en una corrida real, once tomas de la misma escena repetían los mismos
  seis pasos de login, casi seis minutos de reloj.

### En contra / lo que se resignó

- **Depende del Chrome de la persona**: su versión, su ubicación. Sin él, cinco
  habilidades desaparecen y una plantilla que las nombra las reporta como
  faltantes (`Runtime.generarEquipo` → `herramientasFaltantes`).
- **`--headless=new` es un árbol de procesos**: un turno abortado dejaba
  ayudantes huérfanos (medimos seis tras una tarde). Se lanza `detached` y se
  mata el grupo entero (`crearLimpieza`).
- **El código que se evalúa en la página viaja dentro de un template literal**:
  una barra sin escapar se la come el template —la regex de espacios llegaba
  como `/s+/g` y le comía las eses a cada palabra— y un backtick cierra el
  template. Los comentarios sobre ese código van afuera.
- **Dos Chrome no conviven sobre el mismo perfil**: hay un candado por nombre de
  sesión (`tomarSesion`) y la toma que llega segunda graba con un perfil
  temporal y lo avisa.

### Cómo se revisaría

Si CDP cambiara de forma incompatible o Chrome dejara de estar en las máquinas
de trabajo, el reemplazo natural es Playwright como dependencia, aceptando el
peso. La interfaz interna (`abrirRevelado`, `abrirGrabacion`) está pensada para
que ese cambio no toque a los motores.

## Qué lo fija

- `packages/tools/src/skills/skills.test.ts` → "el motor de estudio se registra
  sólo si hay navegador".
- `packages/tools/src/skills/estudio.test.ts` → "ata cada lámina a su escena por
  el número del nombre", "las ventanas se pisan, que es lo que hace posible el
  encadenado".
- `packages/tools/src/skills/clips.test.ts` → `tomarSesion` ("sanea el nombre: el
  perfil es una ruta, no lo que escribió un modelo", "dos tomas a la vez sobre la
  misma sesión: la segunda graba igual y avisa") e `informeDeExploracion`.

## Fuentes

- `packages/tools/src/skills/chrome.ts` → `buscarChrome`, `CANDIDATOS`, `CORTE`,
  `LIENZO`, `ANIMACION_MAXIMA`, `abrirRevelado`, `abrirGrabacion`, `crearLimpieza`
- `packages/tools/src/skills/index.ts` → `createSkillTools` (`hayNavegador`),
  `tomarSesion`, `crearExplorarPantalla`, `crearGrabarClip`
- `packages/tools/src/skills/estudio.ts`, `packages/tools/src/skills/clips.ts`

## Ver también

- [[Navegador Chrome por CDP]] · [[Motor estudio de láminas HTML]] · [[Motor de clips grabados]]
- [[ADR-017 Tres motores de video comparten el reloj]] · [[Producción audiovisual]]
