---
tags: [capacidad, móvil]
aliases: [R2, Cloudflare R2, r2_listar, r2_objetos, R2Storage, crearR2Storage, firmarS3, SigV4, detectarContenido, credencialesR2, r2.ts]
---

# Almacenamiento R2

> Cloudflare R2 para **verificar**, no para escribir: que la foto que la app dice
> haber subido esté de verdad en el bucket, que no pese 0 bytes y que sea del tipo
> que declara. Es `inspeccionar_medio` aplicado al almacenamiento.

Código: `packages/tools/src/codigo/r2.ts` (las herramientas y la interfaz
`R2Storage`) y `apps/server/src/r2.ts` (`crearR2Storage`, la firma SigV4 y los
parsers). Lo usa sobre todo el [[QA móvil]].

## Por qué existe

Un agente que valida una subida mirando sólo la UI o la respuesta del backend
**repite lo que le dijeron**. Que la app diga "10 fotos subidas" no prueba que estén en
R2, ni que no pesen 0 bytes, ni que un `image/jpeg` no sea un PNG. El bucket es la
fuente de verdad. Es la misma idea que `inspeccionar_medio` para un video: medir lo
producido en vez de repetir lo que dijo la herramienta que lo produjo.

Tres decisiones (`apps/server/src/r2.ts`, comentario de cabecera):

- **Sin SDK.** R2 habla S3, y S3 es HTTP firmado con SigV4: se firma con `crypto` de
  Node. Es la misma regla de ffmpeg, Kokoro y Chrome —usar lo que hay—, y evita traer
  un SDK de 3 MB para dos verbos de lectura (`GET` y `HEAD`).
- **Las credenciales son las del servicio**, leídas de sus `.env` en el momento, como
  hace la vista previa. No se copian a la base ni al prompt: el agente nombra una
  clave y recibe metadatos, **nunca una llave**.
- **Sólo staging.** Si el entorno del servicio tiene un marcador de producción del
  repo, no se consulta: el bucket de producción tiene fotos de clientes reales.

## Las herramientas

| Herramienta | `readOnly` | Parámetros | Qué hace |
|---|---|---|---|
| `r2_listar` | sí | `prefijo` (vacío = la raíz; sin `/` inicial), `carpetas` (agrupa por `/`), `limite` (1-200, default 50), `desde` (el token para seguir), `repo` | lista objetos: clave, tamaño y fecha, y marca los vacíos |
| `r2_objetos` | no | `claves` (1-20, sin repetir, sin `/` inicial), `guardar`, `repo` | verifica claves concretas: existencia, tamaño, tipo declarado y **real**, fecha y metadatos; con `guardar`, descarga hasta 5 |

`r2_objetos` no es `readOnly` porque con `guardar` escribe en la salida del proyecto.
Acepta **hasta 20 claves** a propósito: verificar un lote entero en una llamada, por lo
del costo cuadrático de un turno delegado (ver [[Turnos delegados a un CLI]]).

Se registran **siempre**, aunque no haya credenciales, como las de código
(`Runtime.registrarCodigoEn`): sin credenciales, cada una dice cuáles faltan y dónde
van. Están en `HERRAMIENTAS_DE_CODIGO` y en el rol `QA_MOVIL`.

## De dónde sale el bucket

`crearR2Storage({ repos, guardarEnSalida })` → `objetivo(repo)`:

1. Los repos del proyecto; con `repo`, sólo el que coincide por id, slug o nombre.
2. Por cada repo, sus servicios **con la API primero** (es la que sube a R2).
3. El entorno de cada servicio: sus `.env` (`archivosEntorno`) y encima
   `servicio.entorno`.
4. Un servicio sin `R2_BUCKET`, `R2_ENDPOINT` ni `R2_ACCOUNT_ID` se saltea.
5. `credencialesR2(env)`: si faltan variables, se anota y se sigue con el próximo.
6. `detectarProduccion(env, marcadores)` con los `marcadoresProduccion` **de todos los
   servicios del repo** (se configuran en el servicio móvil): si es producción, se
   niega ahí, nombrando las variables y no sus valores.
7. El primero que pasa es el bucket.

Sin ninguno: "Ningún servicio del proyecto tiene credenciales de R2 en su entorno
(R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY y R2_ENDPOINT o R2_ACCOUNT_ID).
Las carga una persona en el .env del backend." Con incompletos, dice qué le falta a
cada uno.

### `credencialesR2`

| Variable | Obligatoria | Uso |
|---|---|---|
| `R2_ENDPOINT` | una de las dos | la URL de la cuenta (sin `/` final) |
| `R2_ACCOUNT_ID` | una de las dos | si no hay endpoint: `https://<cuenta>.r2.cloudflarestorage.com` |
| `R2_BUCKET` | sí | — |
| `R2_ACCESS_KEY_ID` | sí | — |
| `R2_SECRET_ACCESS_KEY` | sí | — |
| `R2_REGION` | no | default `auto` |

Son las que usa el backend de INSPIA y las que propone la documentación de R2. Van en
el `.env` **del servicio**, no en el del orquestador (ver
[[Configuración de repos y servicios]]).

## La firma: SigV4 propio

`firmarS3` es **pura** —recibe la fecha—, así que se fija con los vectores de ejemplo
de la documentación de AWS. Para un pedido sin cuerpo:

1. Cabeceras: `host`, `x-amz-content-sha256` (el hash del cuerpo vacío), `x-amz-date`
   y las extra (por ejemplo `range`), en minúsculas y ordenadas.
2. Pedido canónico: método, ruta codificada (RFC 3986, conservando `/`), query ordenada
   y codificada, cabeceras canónicas, lista de firmadas y el hash vacío.
3. Cadena a firmar: `AWS4-HMAC-SHA256`, fecha, alcance
   `<día>/<región>/s3/aws4_request` y el hash del pedido canónico.
4. Clave derivada: HMAC en cadena de `AWS4<secreto>` → día → región → `s3` →
   `aws4_request`.
5. Devuelve las cabeceras con `authorization` (sin `host`, que pone `fetch`).

`pedirR2` arma la URL **estilo ruta** (`/<bucket>/<clave>`: R2 no requiere subdominio
por bucket) y usa `fetch` con **20 s de corte**: un endpoint que acepta la conexión y
se calla colgaría el turno.

## Qué devuelve

### `r2_listar`

`ListObjectsV2` (`list-type=2`, `max-keys`, `prefix`, `delimiter=/` con `carpetas`,
`continuation-token` con `desde`). `parsearListado` saca objetos (clave, tamaño,
fecha), carpetas y el token si está truncado. La respuesta:

```text
Bucket inspia-files (de Backend), prefijo «projects/p1/»: 2 objeto(s), 2.0 KB, 1 carpeta(s).
📁 projects/p1/visitas/
projects/p1/a.jpg  2.0 KB  2026-09-26T12:00:00.000Z
projects/p1/b.jpg  0 B  2026-09-26T12:01:00.000Z  ⚠️ VACÍO
Hay más: repetí con desde="…".
```

### `r2_objetos`

Por cada clave:

1. **`HEAD`**: 404 → "❌ NO EXISTE en el bucket"; otro error → el código de S3.
2. Tamaño (`content-length`), tipo declarado (`content-type`) y los `x-amz-meta-*`
   (hasta 120 caracteres cada uno).
3. **0 bytes** → "está VACÍO".
4. Si no, **`GET` con `Range: bytes=0-31`** y `detectarContenido` saca el tipo real de
   los primeros bytes. Aviso si declara uno y es otro ("declara image/jpeg pero el
   contenido es image/png"), o si no se reconoce el formato. Excepciones: el texto no
   tiene firma en sus bytes (`text/*`, `json`, `xml`, `csv` no se avisan), y un
   `video/mp4` detectado pasa contra cualquier `video/*` declarado.
5. Con `guardar`: descarga el objeto a `revision/r2/` de la salida (nombre = la última
   parte de la clave, saneada), **hasta 5 por llamada y 25 MB cada uno**, para que el
   agente lo abra y lo mire.

Cada línea empieza con ✅, ⚠️ o ❌. Un error de S3 se explica con su `<Code>` y su
`<Message>` del XML: eso es lo que sirve para corregir, no un 403 a secas.

### `detectarContenido`

| Primeros bytes | Tipo |
|---|---|
| `FF D8 FF` | `image/jpeg` |
| `89 50 4E 47 0D 0A 1A 0A` | `image/png` |
| `RIFF` … `WEBP` | `image/webp` |
| `ftyp` con marca `heic`, `heix`, `mif1`, `msf1` o `hevc` | `image/heic` |
| `ftyp` con otra marca | `video/mp4` |
| `%PDF-` | `application/pdf` |
| `GIF87a` / `GIF89a` | `image/gif` |
| `PK 03 04` | `application/zip` |

## Constantes

| Nombre | Valor | Archivo | Por qué |
|---|---|---|---|
| `CORTE_MS` | 20 s | `apps/server/src/r2.ts` | todo pedido a la red lleva corte |
| `MAX_DESCARGA` | 25 MB | `apps/server/src/r2.ts` | una foto de teléfono, holgada |
| descargas por llamada | 5 | `objetos` | — |
| claves por llamada | 20 | `packages/tools/src/codigo/r2.ts` | un lote en una vuelta |
| `limite` | 1-200, default 50 | `packages/tools/src/codigo/r2.ts` | — |
| bytes para el tipo real | 32 (`Range: bytes=0-31`) | `objetos` | no hace falta bajar el archivo |

## Seguridad

- **Sólo lectura**: `GET` y `HEAD`, nada más.
- **Las llaves no salen del servidor**: ni en el resultado ni en los errores (fijado
  por test: ni el secreto ni el id de la llave aparecen en el texto).
- **Sólo staging**: con un marcador de producción, no se hace ni un pedido.
- Las descargas van a la salida por `ExportStore` (ruta saneada, marcadas como
  generadas).

## Casos borde

| Síntoma | Causa |
|---|---|
| "El servicio declara R2 pero le faltan variables" | el `.env` del servicio tiene algunas `R2_*` y no todas |
| "…apunta a producción: el bucket de producción no se consulta" | un marcador de producción en el entorno del servicio con R2 |
| "R2 contestó 403 SignatureDoesNotMatch" | credenciales mal copiadas o reloj de la máquina desfasado |
| "no se descargó: pesa más de 25 MB" / "hasta 5 por llamada" | los topes de `guardar` |
| La clave no existe pero la base la tiene | la subida falló o fue a otra ruta: es un hallazgo |

## Qué fijan los tests

`apps/server/src/r2.test.ts`:

- "GET de un objeto con Range" y "listado con query ordenada" — la firma coincide con los vectores de SigV4 de la documentación de AWS.
- "el listado, con carpetas y el token para seguir".
- "el tipo real sale de los primeros bytes".
- "credenciales: el endpoint sale de la cuenta si no está, y se nombra lo que falta".
- "verifica un lote: lo que falta, lo vacío y lo que miente su tipo; nunca devuelve las llaves" — y las URLs y firmas de cada pedido.
- "no consulta si el entorno apunta a producción (por los marcadores del repo)" — `fetch` no se llama.
- "sin credenciales dice cuáles faltan y dónde van".

## Fuentes

- `packages/tools/src/codigo/r2.ts` → `crearHerramientasDeR2`, `R2Storage`, `HERRAMIENTAS_DE_R2`
- `apps/server/src/r2.ts` → `crearR2Storage`, `credencialesR2`, `firmarS3`, `pedirR2`, `parsearListado`, `detectarContenido`, `CORTE_MS`, `MAX_DESCARGA`
- `apps/server/src/qa-movil.ts` → `detectarProduccion`
- `apps/server/src/runtime.ts` → `registrarCodigoEn`

## Ver también

- [[QA móvil]]
- [[CU-07 Barrido de QA en el teléfono]]
- [[Servicios del monorepo]]
- [[Referencia de herramientas]]
