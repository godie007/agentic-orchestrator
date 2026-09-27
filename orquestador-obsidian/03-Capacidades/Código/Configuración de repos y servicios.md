---
tags: [capacidad, ide]
aliases: [Repositorio.tsx, Servicios.tsx, VistaDeServicio.tsx, SalidaDeServicio.tsx, CargarRepo, EditorDeComandos, FormularioDeServicio, ConsolaDeApi, Navegador, Levantar todo, vista Repositorio, vista Servicios]
---

# Configuración de repos y servicios

Dos vistas laterales de [[El IDE]] y la pestaña de un servicio levantado:

- **Repositorio** (ícono de engranaje): cargar código, elegir si los agentes
  commitean, editar qué comandos se pueden correr y sacar un repo del proyecto.
- **Servicios** (ícono de cajas): las partes de un monorepo —backend, frontend,
  app móvil, documentación—, cómo se levanta cada una y su configuración.
- **La pestaña de un servicio**: el frontend en un navegador embebido, una
  consola para la API, o el teléfono.

Cómo se clona, qué es una sesión y cómo se detectan los servicios está del lado
servidor, en [[Repositorios y sesiones]] y [[Servicios del monorepo]].

## La vista Repositorio

`apps/web/src/routes/codigo/Repositorio.tsx` → `Repositorio`. Con más de un repo,
un `select` arriba elige cuál se configura; el ícono de la barra de actividad y
"configurar" de una raíz del explorador lo dejan elegido.

### Datos y ajustes

- Nombre (editable en el lugar: `POST /api/repos/:id/renombrar`), origen, rama
  base y la ruta de la copia gestionada.
- **"Los agentes hacen commit al terminar cada turno"**
  (`PATCH /api/repos/:id/ajustes` → `commitsAutomaticos`). Apagado por default:
  los cambios quedan sin commitear para que la persona los prepare y publique,
  como en Cursor; cada pedido del chat igual se puede ver y deshacer. Ver
  [[Instantáneas y checkpoints]].

### Comandos

`EditorDeComandos` edita `repositorio.comandos`:

| Campo | Qué es |
|---|---|
| Permitidos (uno por renglón) | prefijos de argv que un agente —y la terminal— pueden correr sin preguntar |
| Tests | cómo se corren los tests: lo primero que un agente necesita |
| Verificar | typecheck, lint o build |
| Preparar el worktree | lo que deja una sesión nueva lista (`npm ci`); se corre a mano la primera vez |
| Correr sin aislamiento | opt-in en ámbar: sin `sandbox-exec`, los tests que escribe un agente corren como tu usuario |

Cada renglón se tokeniza en el navegador (`tokenizar`, la misma función que el
servidor) y un error dice cuál. Guardar manda `PATCH /api/repos/:id/comandos`,
que valida cada prefijo con `validarPrefijoPermitido` y rechaza con 400 los que
lo permiten todo (`npx`, `bash`, `node` a secas, `npm run` sin script) o tocan
credenciales, nombrando cuál. Guardar confirma la lista: apaga
`pendienteDeConfirmar`, el aviso de "estos comandos vinieron importados". Ver
[[Comandos y sandbox]].

### Cargar código

`CargarRepo`: pestañas **Carpeta local** y **URL git**, nombre y rama base
opcionales, y para una carpeta local "Incluir mis cambios sin commitear (sólo
archivos que git ya rastrea)". `POST /api/companies/:companyId/repos` devuelve el
repo, los avisos y los **comandos sugeridos** detectados en el repo, que se
muestran con "No quedan permitidos hasta que lo confirmes" y un botón
**Permitir estos comandos**. Al cargar se registran las herramientas de código de
la empresa y el IDE pasa al explorador con el repo nuevo elegido. Una URL no
puede llevar usuario ni token: el acceso lo da la configuración de git de la
máquina.

### Sacar el repo

Con confirmación, `DELETE /api/repos/:id`: 409 si hay una corrida viva; detiene
sus servicios; borra copia, sesiones y ramas del orquestador, nunca la carpeta de
la persona. Si había trabajo sin integrar queda un respaldo (bundle y patch) en
Salida → `respaldos/`, y el aviso lo nombra.

## La vista Servicios

`apps/web/src/routes/codigo/Servicios.tsx` → `Servicios`, con el estado de
`GET /api/repos/:id/servicios` (cada 1 s si alguno está preparando o arrancando;
si no, cada 10 s, y con cada evento del stream de código). Cada `.env` viene
descrito —ruta, si existe, cuántas variables—; sus valores no salen del
servidor.

Cada fila: ícono por tipo con un punto de estado (gris detenido, ámbar
preparando o arrancando, verde levantado, rojo falló), nombre, "Tipo · carpeta ·
estado", y acciones:

| Acción | Cuándo | Endpoint |
|---|---|---|
| 📦 Instalar dependencias | sin `node_modules` en la sesión | `POST …/servicios/:sid/preparar` (contesta al toque; el avance, en la salida) |
| ▶ Levantar | detenido, preparado y con comando | `POST …/servicios/:sid/arrancar` |
| Reiniciar / Detener | levantado o arrancando | `…/detener` y luego `…/arrancar` |
| Vista previa | levantado | abre la pestaña del servicio |
| Salida | siempre | abre el panel inferior en sus logs |
| Configurar | siempre | despliega el formulario |

Una documentación sólo tiene "leer" (ver [[Notas de Obsidian en el IDE]]).
Levantado, muestra su URL; si falló, el detalle (clic → salida). Mientras corre,
lista las **redirecciones** (`VITE_API_URL → http://127.0.0.1:43xx/api`) y, en
ámbar, las variables que **apuntan afuera**; si el repo tiene una API, un clic
("usar *API* de la vista previa") guarda esa variable como `{url:<api>}<ruta>` y
reinicia.

**Levantar todo** prepara lo que falte y levanta **en orden: API, otros, web,
móvil**. El orden no es cosmético: las URLs a `localhost` de los `.env` se
redirigen a servicios de la vista previa, y un frontend que arranca antes que su
backend le seguiría hablando al de la persona. Espera cada uno (hasta 600
consultas de 1 s) y corta con el nombre del que falló. Hay también **Detener
todos** y **volver a detectar** (`POST …/servicios/detectar`), que conserva lo
configurado de cada servicio por su id.

### El formulario de un servicio

`FormularioDeServicio` guarda con `PUT /api/repos/:id/servicios/:sid` (el id no
cambia: es lo que nombran los agentes).

| Campo | Notas |
|---|---|
| Nombre | |
| Comando de arranque | argv tokenizado; `{puerto}` es el asignado |
| Variable del puerto | `PORT`, si el programa la lee |
| Puerto en tu máquina | el que usa localmente: las URLs a `localhost:<ese>` de los otros servicios se redirigen acá |
| Ruta de salud / Abre en | qué se consulta para saber que está listo; dónde abre la vista |
| Archivos `.env` | rutas absolutas, uno por renglón; se leen **al arrancar**, no se guardan ni se copian al repo |
| Variables extra | `CLAVE=valor` sin secretos; `#` comenta; `{url:backend}` es la URL de otro servicio |
| Marcadores de producción (sólo móvil) | textos de 5 caracteres o más; si alguno aparece en el entorno, los agentes no manejan la app |

El servidor rechaza con 400 un archivo que no sea `.env`, `.env.*` o `*.env` con
ruta absoluta —se inyecta en un proceso que corre código de un agente, no puede
ser la vía para meter `~/.ssh/id_rsa`— y una carpeta fuera del clon. Guardado un
servicio levantado, hay que reiniciarlo para que tome la configuración.

## La pestaña de un servicio

`apps/web/src/routes/codigo/VistaDeServicio.tsx` → `VistaDeServicio`:

- **Detenido** (`NoLevantado`): el motivo según el estado, un botón (Levantar,
  Instalar dependencias o Volver a intentar) y la salida abajo.
- **API** (`ConsolaDeApi`): método, ruta (arranca en la ruta de salud y la pide
  sola al abrir), cabeceras de a una por renglón y cuerpo (no en GET ni HEAD).
  El pedido **sale del servidor** (`POST …/servicios/:sid/probar`), así no
  depende del CORS del backend. Historial de 30, con estado coloreado,
  cabeceras y cuerpo de la respuesta.
- **Web u otro** (`Navegador`): `iframe` a la URL del servicio más la ruta, con
  barra de dirección, recargar, abrir en otra pestaña, anchos de escritorio,
  tablet (820 px) y teléfono (390 px), y los botones **Seleccionar** e
  **Inspector** (ver [[Selector de elementos e inspector]]). Reiniciar el
  servicio recarga el iframe solo.
- **Móvil**: cuatro modos —Teléfono en vivo, Navegador (web), Depuración, Build
  de producción—; el elegido se recuerda en `orq-vista-movil`. Ver
  [[App móvil en el teléfono]].

El iframe del navegador lleva `sandbox="allow-scripts allow-same-origin
allow-forms allow-popups allow-modals allow-downloads"`. `allow-same-origin` es
seguro acá porque es **otro origen** (`127.0.0.1:43xx`): no puede tocar la app
ni leer la API del orquestador, cuyo CORS no lo admite; sólo le deja usar su
propio almacenamiento, donde la app guarda la sesión de su login. En un `web` o
`movil`, ese puerto lo atiende el proxy del selector (ver [[Vista previa y proxy]]).

## La salida

`apps/web/src/routes/codigo/SalidaDeServicio.tsx` → `Salida`, en el panel
inferior o bajo un servicio detenido, como el "Output" de VS Code. Pide **sólo
las líneas nuevas** (`GET …/logs?desde=N`, un contador absoluto del servidor)
cada 1,2 s: con un backend que loguea cada request, traer todo sería megas por
minuto. Si el contador vuelve atrás, el servicio se reinició y la vista se
vacía. Se conservan 4.000 líneas; rojo para errores, ámbar para advertencias;
seguir el final se apaga al subir con la rueda. Los secretos del `.env` llegan
tapados.

## Casos borde

- **Un `.env` que no existe** se marca "no existe" en el formulario; el servicio
  arranca sin esas variables.
- **Levantar sin sesión** la abre: los servicios corren sobre el worktree.
- **Un servicio `otro`** no pasa por el proxy: sin selector ni inspector.
- `api.borrarServicio` y `DELETE /api/repos/:id/servicios/:sid` existen, pero la
  UI no tiene botón para borrar un servicio.

## Qué fijan los tests

- `apps/server/src/servicios.test.ts`: el frontend de la vista previa le habla al
  backend de la vista previa y los secretos no salen en los logs; detener mata
  el proceso; un proceso que se cae queda en fallo con su salida; sin
  dependencias no arranca y lo dice; un monorepo como INSPIA se detecta con API,
  web, móvil y documentación.
- `packages/shared/src/argv.test.ts` → `validarPrefijoPermitido`.

## Fuentes

- `apps/web/src/routes/codigo/Repositorio.tsx` → `Repositorio`, `CargarRepo`, `EditorDeComandos`
- `apps/web/src/routes/codigo/Servicios.tsx` → `Servicios`, `useServicios`, `FilaDeServicio`, `FormularioDeServicio`, `ORDEN`
- `apps/web/src/routes/codigo/VistaDeServicio.tsx` → `VistaDeServicio`, `NoLevantado`, `Navegador`, `ConsolaDeApi`, `VistaMovil`
- `apps/web/src/routes/codigo/SalidaDeServicio.tsx` → `Salida`
- `apps/server/src/rutas-codigo.ts` → rutas de repos, comandos, ajustes y servicios
- `packages/shared/src/schema.ts` → `repositorioSchema`, `comandosRepositorioSchema`, `servicioSchema`

## Ver también

- [[Servicios del monorepo]] · [[Repositorios y sesiones]] · [[Comandos y sandbox]]
- [[Terminal del IDE]] · [[Vista previa y proxy]] · [[El IDE]]
