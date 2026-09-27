---
tags: [caso-de-uso, móvil]
aliases: [CU-08, Release Android, Subir a Play, Generar AAB]
---

# CU-08 Release de la app Android

**Qué se quiere lograr:** armar el AAB de producción de la app para subirlo a Google
Play —o un APK para instalar en el equipo de un cliente— sin las trampas del
procedimiento a mano: que salga del código correcto, con el `.env` de producción, con
la firma de siempre, con un `versionCode` que Play acepte, y **verificado** antes de
subirlo.

El detalle técnico está en [[Build de producción Android]].

## Lo que hay que dejar preparado

| Qué | Dónde | Si falta |
|---|---|---|
| El repo cargado **desde una carpeta local** | pestaña Código | "El repo no viene de una carpeta local: no hay de dónde leer el .env de producción" |
| `.env.prod` (o `.env.production`, `.env.produccion`) con las `EXPO_PUBLIC_*` de producción | la carpeta **original** de la app | el botón queda deshabilitado |
| La firma de release | `~/.gradle/gradle.properties` de la persona | el build sale con la clave de depuración y **no pasa** |
| El script que reinyecta la firma, si el proyecto lo tiene | `scripts/apply-signing.mjs` | aviso: se usa la firma que genere el prebuild |
| JDK 17 y el SDK de Android | Android Studio | "No hay un JDK 17" / "No se encontró el SDK" |
| build-tools con `aapt2` y `apksigner` (sólo para APK) | SDK Manager | el APK no se arma |
| El último AAB publicado, la primera vez | `build-artifacts/` de la app | no hay contra qué comparar `versionCode` y certificado |
| `blockedPermissions` en `app.json` | la app | la verificación de permisos sólo lista |

## El recorrido

### 1. Abrir el modo

Vista del servicio móvil → **Build de producción**. No hace falta tener el servicio
levantado.

### 2. Leer el plan

Antes de construir, la pantalla muestra todo lo que decide qué sale:

- el paquete, la versión de hoy y el **último build** (el del orquestador o, si no hay,
  el `.aab` más nuevo de la carpeta de la persona);
- el **commit** del que va a salir y cuántos cambios sin commitear tiene la app;
- el archivo de **entorno** y los **nombres** de sus variables (nunca los valores);
- la **firma**: el script, si hay, más `~/.gradle/gradle.properties`;
- los **avisos** en amarillo.

### 3. Elegir

- **AAB** (para Play) o **APK** (para instalar directo).
- **Versión** (sugerida: la siguiente, `1.0.18` → `1.0.19`) y **versionCode** (sugerido:
  el mínimo que supera al actual y al anterior).
- **Incluir los cambios sin commitear**: sin marcar, sale del commit (se sabe
  exactamente de qué código salió); marcado, de una instantánea del árbol que queda
  registrada.

### 4. Confirmar y esperar

El diálogo resume: de qué commit sale, con qué `.env`, que al terminar `app.json` de la
sesión queda con la versión nueva sin commitear, y que **el AAB no se sube solo**.
Tarda varios minutos; la pantalla muestra el paso y el registro:

1. copia exacta del código (`git archive`) a una carpeta temporal;
2. versión en `app.json` de la copia;
3. dependencias (clon copy-on-write si el lockfile es el de la sesión);
4. `expo prebuild --clean` con el `.env.prod` y la firma;
5. `gradlew bundleRelease` (o `assembleRelease`);
6. verificaciones.

### 5. Leer las verificaciones

| Verificación | Si falla |
|---|---|
| Paquete y versión | el archivo no dice lo que se pidió |
| versionCode mayor que el anterior | Play lo rechazaría |
| Firmado con la clave de subida | salió con la clave de depuración |
| Mismo certificado que el build anterior | Play rechaza la actualización |
| Permisos | apareció uno de `blockedPermissions` (si no, es un aviso: revisalos contra la ficha de Play) |
| Variables de producción adentro del bundle | falta alguna `EXPO_PUBLIC_*` de producción |
| Nada de desarrollo ni de staging | quedó un valor del `.env` de desarrollo |
| Ninguna URL de la vista previa | quedó un `127.0.0.1:43xx` o un `localhost` de desarrollo |

Con alguna en rojo: **"no lo subas a Play"**.

### 6. Descargar y subir

El archivo queda en `salida/builds/android/<app>-<versión>-<code>.aab` con su `.json`
(commit, sha256, certificado, verificaciones). Se descarga desde la pantalla y **se sube
a Play a mano**: publicar lo decide una persona.

### 7. Commitear la versión

Si todo pasó, `app.json` de la sesión quedó con la versión nueva **sin commitear**:
commitealo con el release desde el control de versiones del IDE (ver
[[Control de versiones y publicación]]). El próximo build parte de ahí.

### 8. Limpiar

"Borrar los anteriores" conservando los últimos N, o uno por uno. **El más reciente no
se borra**: es contra el que se compara el próximo.

## Qué mirar

- **El commit** del resultado es el que esperabas publicar.
- **Todas las verificaciones en verde**; "Permisos" en amarillo es un aviso para leer.
- **El sha256** del archivo que subís es el del resultado.
- **`app.json` en la sesión** tiene la versión nueva y la commiteaste.

## Qué puede salir mal

| Síntoma | Causa |
|---|---|
| "Está firmado con la clave de DEPURACIÓN" | la firma de release no se aplicó: `~/.gradle/gradle.properties` o el script de firma |
| "Cambió el certificado" | se firmó con otra clave que el build anterior |
| El siguiente build falla "Mismo certificado" después de uno fallido | el fallido quedó como "anterior" (su `.json` se guarda igual) y no se puede borrar desde esta pantalla: borralo con su `.json` desde la pestaña Salida |
| "No aparece el valor de producción de: …" | el `.env.prod` no llegó al bundle (variable mal nombrada, sin prefijo `EXPO_PUBLIC_`) |
| "Quedaron valores de desarrollo de: …" | el código lee un valor fijo o el `.env` equivocado |
| "El versionCode tiene que ser mayor que N" | subilo: uno que se subió y se descartó en Play queda quemado |
| "Gradle dejó un APK por arquitectura … ninguno universal" | activá `universalApk` en los splits |
| "app.json de la sesión cambió durante el build" | un agente o la persona lo tocó: subí la versión a mano |
| El build falló y no dice por qué | mirá el final del registro del build |

## Variante: APK para un cliente

Mismo recorrido con **APK**: un solo archivo que se instala en cualquier Android, con la
misma firma y las mismas verificaciones. El `versionCode` también tiene que subir:
Android no instala un APK encima de uno con `versionCode` mayor, ni encima de uno
firmado con otro certificado.

## Ver también

- [[Build de producción Android]]
- [[App móvil en el teléfono]]
- [[CU-07 Barrido de QA en el teléfono]] — probar antes de publicar
