---
tags: [adr, móvil, seguridad]
aliases: [R2, firmarS3, SigV4, r2.ts, r2_listar, r2_objetos]
---

# ADR-021 R2 sin SDK con SigV4 propio

**Estado:** aceptada

## Contexto

En QA móvil, "la app dice que subió 10 fotos" no prueba que estén en el bucket,
ni que no pesen 0 bytes, ni que un `image/jpeg` no sea un PNG. Es
`inspeccionar_medio` aplicado al almacenamiento: un agente que valida una subida
mirando la UI repite lo que le dijeron. El bucket (Cloudflare R2) es la fuente de
verdad, y hacía falta leerlo.

## Decisión

Dos herramientas de **sólo lectura** (`r2_listar`, `r2_objetos`,
`packages/tools/src/codigo/r2.ts`) sobre un almacenamiento del servidor
(`apps/server/src/r2.ts`) **sin SDK**:

- R2 habla S3, y S3 es HTTP firmado con **SigV4**: se firma con `crypto` de Node
  (`firmarS3`, pura, recibe la fecha) y se fija con los **vectores de ejemplo de
  la documentación de AWS**. Dos verbos: `GET` y `HEAD`.
- **Las credenciales son las del servicio**: las `R2_*` del `.env` del servicio
  del repo (el mismo que levanta la vista previa), leídas en el momento. No se
  copian a la base ni al prompt: el agente nombra una clave y recibe metadatos,
  nunca una llave. Si faltan, se dice cuáles y dónde van.
- **Sólo staging**: con un marcador de producción de cualquier servicio del repo
  en el entorno (`detectarProduccion`), no se consulta. El bucket de producción
  tiene fotos de clientes reales.
- `r2_objetos` verifica **hasta 20 claves por llamada** —un lote entero en una
  vuelta, por el costo cuadrático de un turno delegado— y saca el tipo **real**
  de los primeros bytes (`Range: bytes=0-31`). Con `guardar` descarga hasta 5 a
  la salida para mirarlas.
- Todo pedido lleva corte (`CORTE_MS` = 20 s) y la descarga tiene tope
  (`MAX_DESCARGA` = 25 MB).

## Alternativas consideradas

**El SDK de AWS para S3.** Rechazada: unos 3 MB de dependencia para dos verbos
de lectura. Es la regla de ffmpeg, Kokoro y Chrome: usar lo que hay.

**Un servidor MCP de Cloudflare.** Rechazada: pondría credenciales con permisos
de escritura al alcance del agente y en la configuración de MCP, y no sabría
qué entorno es producción.

**Verificar por la API del backend de la app.** Rechazada como única fuente: es
justamente la respuesta del backend la que se quiere contrastar.

## Consecuencias

### A favor

- Cero dependencias; firma verificada contra vectores públicos.
- Las llaves nunca salen del servidor ni llegan a un prompt.
- Producción queda fuera por construcción.

### En contra / lo que se resignó

- **Sólo lectura y sólo lo implementado**: ni escritura, ni multipart, ni URLs
  prefirmadas, ni los reintentos y la resolución de endpoints que trae un SDK.
- **El código de firma es nuestro**: cualquier cambio en SigV4 o en cómo R2
  interpreta el canon lo mantenemos nosotros.
- **Depende de nombres de variables** (`R2_ENDPOINT` o `R2_ACCOUNT_ID`,
  `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_REGION`): un
  backend que las llame distinto no se reconoce.

## Qué lo fija

- `apps/server/src/r2.test.ts` → `firmarS3` con los vectores de SigV4 para S3
  ("GET de un objeto con Range", "listado con query ordenada"), "el tipo real
  sale de los primeros bytes", "verifica un lote: lo que falta, lo vacío y lo que
  miente su tipo; nunca devuelve las llaves", "no consulta si el entorno apunta a
  producción", "sin credenciales dice cuáles faltan y dónde van".

## Fuentes

- `apps/server/src/r2.ts` → `firmarS3`, `credencialesR2`, `crearR2Storage`,
  `CORTE_MS`, `MAX_DESCARGA`
- `packages/tools/src/codigo/r2.ts` → `r2_listar`, `r2_objetos`
- `apps/server/src/qa-movil.ts` → `detectarProduccion`

## Ver también

- [[Almacenamiento R2]] · [[QA móvil]] · [[CU-07 Barrido de QA en el teléfono]]
