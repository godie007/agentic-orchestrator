---
tags: [caso-de-uso, producción]
aliases: [CU-09, Tutorial filmado, INSPIA Publicidad, db:inspia-publicidad, Pieza comercial filmada]
---

# CU-09 Tutorial filmado sobre una app real

**Qué se quiere lograr:** una pieza de 2 a 3 minutos que muestre una aplicación
**funcionando de verdad** —no capturas quietas—: un clip real por escena, filmado
sobre el ambiente de staging, empalmado con narración y música. Es el caso para
el que existe el [[Motor de clips grabados]].

El ejemplo es **INSPIA — Publicidad** (`npm run db:inspia-publicidad`,
`scripts/seed-inspia-publicidad.ts`): la pieza comercial de una plataforma de
inspección, filmada sobre el tenant de demo de staging.

## Configuración

Cuatro áreas (Dirección, Contenido, Producción, Calidad) y seis roles, todos por
`claude-code` con **escalado por dificultad** acotado por rango de tier (ver
[[Escalado por dificultad]]): `smart` para los que **deciden** (guion, dirección,
calidad), `standard` para los que **ejecutan**. Nada por OpenRouter: en una
producción de doce clips el gasto real se va en los reintentos, y una corrida
agotó el saldo y las siguientes murieron con 402.

| Rol | Autoridad | Tier | Habilidades |
|---|---|---|---|
| **Valentina Ríos** — Directora de la pieza | `executive` | smart | `read_output_file`, `list_output`, `inspeccionar_medio` |
| **Camilo Restrepo** — Investigador de producto | `executor` | standard | `list_output`, `read_output_file` (+ MCP de Obsidian) |
| **Lucía Fernández** — Guionista publicitaria | `manager` | smart | sólo coordinación |
| **Diego Salas** — Director de rodaje | `manager` | standard | `grabar_clip`, `export_video_clips`, `inspeccionar_medio`, `extraer_cuadros`, `write_output_file`, `read_output_file`, `list_output`, `delete_files` |
| **Marina Quiroga** — Control de calidad | `manager` | smart | `extraer_cuadros`, `inspeccionar_medio`, `read_output_file`, `list_output` |
| **Sofía Marín** — Supervisora de producción | `manager` | standard | `list_output`, `read_output_file`, `inspeccionar_medio` |

El director de rodaje es `manager` y no `executor` **porque tiene que poder
borrar su propio material**: un ejecutor no borra, y la cadena se trababa en el
primer clip que había que reemplazar (dos tomas de la misma escena que no se
podían limpiar). Ver [[Archivos de salida y permisos de borrado]].

Dos roles que una agencia normal no tendría, y los dos salen de la misma lección
—**medir no es mirar**, y un clip que "no reportó errores" puede estar filmando un
spinner—: quien **reconoce** la aplicación antes de filmarla y quien **mira** los
cuadros antes de aprobar. La supervisora existe porque doce clips no entran en una
corrida: mira `estado_del_proceso`, destraba lo heredado y deja un traspaso
(`estado-produccion-inspia`). Ver [[Supervisión y continuidad]].

- **Voz**: `unaSolaVoz: true` (habla la marca) y pronunciación de siglas
  (`INSPIA`, `RETIE`, `NC → ene ce`, `kV → kilovoltios`…).
- **Marca**: `acento #f85601`, `panel #082d52`, `rotulos: false` —la aplicación ya
  trae sus propios títulos—. Ver [[Voz y marca de la empresa]].
- **MCP**: `obsidian` (la documentación del producto, token por referencia) y
  `playwright` (reconocimiento y datos de demo, con su salida dentro del
  directorio de la empresa). Ver [[Integración MCP]].
- **Memoria sembrada**: lecciones de la corrida que filmó un tutorial anterior
  (acceso al ambiente, trampas de la aplicación). Las credenciales del tenant de
  demo están ahí; no se copian a esta bóveda.
- Cuatro políticas: **Sólo se promete lo que se ve**, **Se reconoce antes de
  filmar**, **Nada se aprueba sin mirarlo**, **El avance se ve en el tablero**.

## El recorrido

```mermaid
sequenceDiagram
  participant D as Directora
  participant I as Investigador
  participant G as Guionista
  participant R as Rodaje
  participant Q as Calidad
  D->>D: assign_task por etapa; estado_del_proceso cada turno
  I->>I: vault de Obsidian → brief-inspia
  G->>R: lista de escenas (¿se puede filmar cada pantalla?)
  G->>G: guion-inspia-publicidad: # + una ## por pantalla
  R->>R: reconocer: textos exactos, URLs, datos de demo
  R->>R: portada.html → grabar_clip("00-portada", salida://portada.html)
  loop cada escena
    R->>R: grabar_clip("NN-…", preparación fuera de cámara, acciones)
  end
  R->>R: export_video_clips → inspeccionar_medio
  Q->>Q: extraer_cuadros → Read de cada PNG → REUTILIZAR / REGRABAR
  D->>D: mira los cuadros y aprueba o devuelve
```

### 1. El guion: una escena por cosa que se ve

Cada escena se filma como un clip real, así que **una escena cuya narración no
corresponde a una pantalla no se puede filmar**. La guionista coordina la lista
con el rodaje antes de cerrar. Reglas del formato que el motor paga caro si no se
cumplen:

- El `#` es lo **primero** del archivo (sin encabezado de documento).
- Nada entre el `#` y la primera `##`: "Personajes:" o "Tono:" se leen en voz alta.
- **La voz en off es el reloj**: el video dura lo que dura la narración. Unas 30
  palabras por escena (dos o tres frases) y 10 a 14 escenas. `estimar_duracion`
  lo confirma sin filmar.

Fragmento de la versión 26 del guion real (16 escenas: portada y 15 `##`):

```markdown
# INSPIA: toda inspección, en un solo lugar

## :alerta: El registro es el problema

La inspección se hace bien. El registro es el problema.

## :chequeo: El inspector avanza ítem por ítem

El inspector abre su visita y ve el avance, ítem por ítem: cada requisito
queda marcado Cumple o No cumple a medida que se evalúa.
```

Es una pieza publicitaria, no un recorrido por pantallas: gancho con el dolor del
comprador, la respuesta, cada pantalla como prueba, el alcance multisector y un
cierre con llamado a la acción.

### 2. Reconocer antes de filmar

`grabar_clip` espera **texto literal**: si se adivina una etiqueta, la toma muere
tras 30 segundos de espera. Por eso primero se reconoce cada pantalla y se anota
(el seed guarda un `mapa-de-rodaje`: login, URLs, textos a esperar, clics).

La herramienta pensada para esto es `explorar_pantalla`, con **la misma `sesion`**
que después graba: mismo login, mismo lienzo de 1920×1080, y dice qué textos son
**estables** y cuáles son loaders. Playwright queda para crear los datos de demo
(un proyecto con nombre real, inspecciones con contenido: una lista vacía no vende
nada).

### 3. Filmar

```json
{
  "archivo": "07-checklist",
  "sesion": "inspector",
  "preparacion": [
    { "ir": "https://<staging>/inspector/visitas" },
    { "esperar_texto": "Mis visitas" }
  ],
  "acciones": [
    { "esperar_texto": "Mis visitas" },
    { "clic": "Visita 014" },
    { "esperar": 2000 },
    { "esperar_texto": "Cumple" }
  ],
  "colchon_segundos": 2.5
}
```

- El **login va en la preparación**, nunca en cámara. Con `sesion`, sólo en la
  primera toma: las siguientes arrancan directo en la pantalla. Si la sesión venció,
  la toma falla en el primer paso y se vuelve a poner el login una vez.
- Cada acción arranca con `esperar_texto` sobre algo que ya está: la regla
  anti-loader.
- **La portada** (`00-portada`) se filma sobre un HTML propio con
  `ir: "salida://portada.html"`: fondo de marca, el nombre grande, una línea de
  posicionamiento y una entrada de uno o dos segundos. Nada en bucle, nada de red.
- Los sondeos van con un nombre descartable: grabar uno con el número de la escena
  **pisa la toma buena**.

### 4. Empalmar y verificar

```text
export_video_clips(artifact_key: "guion-inspia-publicidad", folder: "…", musica: "corporativo")
inspeccionar_medio(path: "…/guion-inspia-publicidad.mp4")
extraer_cuadros(path: "…/guion-inspia-publicidad.mp4", cantidad: 12)
```

El resultado dice cuántas escenas encontró, cuáles salieron como placa lisa, si
abre con la portada y si había dos tomas para la misma escena. Hay que **leerlo**:
si la cantidad de escenas no coincide con las `##` del guion, algo partió una
escena y falta un clip.

### 5. Mirar

Calidad extrae cuadros (`revision/<video>-NN-tXs.png`, el segundo en el nombre) y
**abre cada PNG** con su `Read`, comparándolo con lo que se narra en ese instante.
Un veredicto por escena: **REUTILIZAR** o **REGRABAR** diciendo qué está mal (un
loader, una lista vacía, un modal tapando, la pantalla equivocada, texto ilegible a
1080p). Además, las dos fallas que sólo aparecen al final: que el video **tenga
audio** y que ninguna escena sea una placa lisa.

## Lo que la aplicación enseñó (lecciones sembradas)

- El clic sobre el menú lateral fallaba de forma reproducible dentro de
  `grabar_clip`: se navega directo con `ir` a la URL absoluta (un path relativo
  falla con "Cannot navigate to invalid URL").
- Las tablas se hidratan **después** de que aparece su título: un clic inmediato no
  da error pero no hace nada. Un `esperar` de 2-3 s, o mejor, `esperar_texto` sobre
  lo que confirma la acción.
- Filmar muta datos de staging y muchas acciones son irreversibles (un dictamen
  emitido ya no muestra sus botones): se crea material propio en la preparación y
  se filma en el orden del flujo real.

## Qué puede salir mal

| Síntoma | Causa |
|---|---|
| la toma murió a los 30 s | `esperar_texto` con una etiqueta adivinada o un loader como ancla |
| el video está corrido una escena | la portada se numeró `01`, o un `###`/`---` partió una escena |
| una escena es una placa lisa | falta su clip o no se pudo abrir |
| sale la toma vieja | dos clips con el mismo número (el resultado lo avisa: borrá el que sobra) |
| el video arranca leyendo notas | texto entre el `#` y la primera `##` |
| el clip se corta antes de terminar la interacción | la narración de la escena es más corta que el clip |
| el video salió mudo | lo dice `inspeccionar_medio`: "SIN PISTA DE AUDIO" |

## Diferencias con lo que dice el seed

Las instrucciones del director de rodaje en el seed son anteriores a dos mejoras
del motor: todavía dicen que **cada toma abre un navegador nuevo sin sesión** (hoy
existe `sesion`) y que el reconocimiento se hace con Playwright (hoy existe
`explorar_pantalla`, que no se le otorga). Funciona igual, pero repite el login en
cada toma y reconoce en otro navegador.

## Ver también

- [[Motor de clips grabados]]
- [[Navegador Chrome por CDP]]
- [[Imágenes y medios]]
- [[Guion como línea de tiempo]]
- [[CU-02 Video institucional]]
- [[CU-04 Control de calidad entre agentes]]
