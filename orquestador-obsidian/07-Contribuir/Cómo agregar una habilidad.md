---
tags: [contribuir, producción]
aliases: [Nueva habilidad, Nueva skill, createSkillTools, SkillStorage, origin skill]
---

# Cómo agregar una habilidad

Una **habilidad** es lo que un rol sabe *producir*: un Word, un PDF, un video,
un deck. No es un sistema aparte: es una herramienta con `origin: "skill"` que
se asigna por rol como cualquier otra y que la UI agrupa aparte. Si lo tuyo es
coordinación o consulta, no es una habilidad: ver [[Cómo agregar una herramienta]].

## Las reglas antes del código

1. **Recibe la clave de un entregable, nunca el contenido.** Un documento largo
   pasado como argumento se trunca cuando el modelo agota `max_tokens` a mitad
   del JSON ([[ADR-005 Las habilidades trabajan sobre entregables ya escritos]]).
   El agente guarda con `write_artifact` y te pasa `artifact_key`.
2. **No decide dónde van los archivos ni lee el disco.** Escribe por el
   `SkillStorage` que inyecta el servidor, que sanea cada ruta.
3. **Si no se puede cumplir, no se registra.** Una habilidad que siempre falla
   hace gastar turnos intentándola (así quedan fuera `generar_imagen` sin key y
   las del navegador sin Chrome).
4. **Toda llamada de red o proceso externo lleva corte por tiempo.**
5. **Nada de reloj adentro**: la fecha entra formateada desde quien llama.
6. **Un archivo por entregable y formato** (`key.pdf`, no `key-v3.pdf`); la
   versión va adentro del archivo.
7. **Nada puede hacer fallar la pieza por un accesorio**: sin música se produce
   en silencio, una imagen que no se pudo mostrar vuelve como aviso en el
   resultado —lo único que el agente puede leer para corregir—.

## 1. La herramienta

En `packages/tools/src/skills/index.ts`, una fábrica que recibe el storage:

```ts
function crearMiSkill(storage: SkillStorage): RegisteredTool {
  return {
    name: "export_mi_formato",
    origin: "skill",
    readOnly: false,            // escribe un archivo: no corre en paralelo a ciegas
    requiresApproval: false,
    description: "Convierte un entregable ya escrito en … Primero write_artifact, después la clave.",
    inputSchema: {
      type: "object",
      properties: {
        artifact_key: { type: "string", description: "Clave del entregable, tal como la usaste en write_artifact" },
        folder: { type: "string", description: "Carpeta de la salida; se crea sola." },
      },
      required: ["artifact_key"],
      additionalProperties: false,   // sin esto el memo de lecturas no funciona
    },
    async execute(args, ctx) {
      const entregable = await buscarEntregable(args, ctx); // explica qué claves existen
      if ("error" in entregable) return entregable.error;
      const bytes = await renderMiFormato(entregable.artifact.content, { /* meta */ });
      const guardado = await storage.save({ filename: `${entregable.artifact.key}.ext`, bytes });
      return ok(`Generado en ${guardado.path} (v${entregable.artifact.version}).`, guardado.path);
    },
  };
}
```

- `buscarEntregable` ya resuelve la clave y, si no existe, **lista las que sí**:
  un "no existe" a secas hace que el agente reintente con la misma clave
  inventada.
- Si el documento lleva cifras de plata o porcentajes, pasalo por
  `revisarCifras` antes de exportar (el gate de [[Invariantes de arquitectura]]
  4.9).
- Los errores vuelven con `fail(…)` y dicen **qué hacer**: el resultado es lo
  único que lee el agente.
- `ok(content, preview)`: el segundo argumento es lo que muestra la UI.
- Si el formato sale del markdown, **parsealo con `parseMarkdown`**
  (`skills/markdown.ts`): las salidas no pueden decir cosas distintas. Si es
  audiovisual, usá `parseGuion`, `ubicarEscenas`, `crearNarrador` y
  `construirSonido` ([[ADR-017 Tres motores de video comparten el reloj]]).

## 2. El contrato del storage

`SkillStorage` (mismo archivo) es lo único que la habilidad sabe del disco:

| Método | Para qué |
|---|---|
| `save({filename, folder?, bytes})` | guardar; devuelve `url`, `path`, `sizeBytes`; el servidor sanea y marca como generado |
| `list()` | lo que hay, con `esMultimedia` y `generadoPorAgente` |
| `remove(path)` / `removeMany({kind, folder?, excluir?})` | borrar como agente (aplica la procedencia) |
| `writeText(path, content)` | crear o reemplazar texto |
| `resolve(path)` | la ruta absoluta **ya saneada** de algo que hay que abrir (una imagen), o `null` |

Lo implementa `ExportStore.forCompany` (`apps/server/src/exports.ts`). Si tu
habilidad necesita algo más del servidor (un proveedor, una carpeta de
recursos), agregalo a `OpcionesHabilidades` y que lo pase `Runtime.companyRuntime`
—no lo leas de `process.env` adentro de la herramienta salvo lo que ya hace así
el resto del módulo—.

## 3. Registrarla

En `createSkillTools` (mismo archivo), con la condición si depende del entorno:

```ts
return [
  // …
  ...(hayLoQueNecesito ? [crearMiSkill(storage)] : []),
];
```

`Runtime.companyRuntime` registra las habilidades **por empresa** (cada una
escribe en su propia salida). No hace falta tocar más: al crear una empresa,
`Runtime.sembrarHerramientas` guarda la fila en `tools` y la habilidad queda
asignable. En empresas existentes aparece al levantar su runtime y
sembrarse de nuevo (lo hace `generarEquipo` o `registrarHerramientasDeCodigo`;
el seed lo hace con `npm run db:seed`).

> [!danger] Una habilidad no se otorga sola
> `ToolRegistry.forRole` sólo regala las de coordinación. Sin fila en `tools` y
> sin estar en `role.toolIds`, el agente explica que no encuentra tu
> herramienta. Si la querés en un equipo de plantilla, sumala por nombre en
> `herramientas` del rol ([[Cómo agregar una plantilla de equipo]]).

## 4. Que el agente sepa usarla

- La **descripción** es la instrucción: el flujo en dos pasos, qué acepta, qué
  devuelve. Un ejemplo corto ayuda más que una regla.
- Si la habilidad necesita un formato de entrada (como el guion del video),
  documentá la sintaxis en la descripción y rechazá con explicación lo que no
  la cumple.
- `apps/web/src/lib/acciones.ts` → `ACCION_HUMANA`: cómo se dice en castellano lo
  que hace ("arma el PDF").

## 5. Tests

En `packages/tools/src/skills/*.test.ts`, con un storage en memoria:

- que se registra (y que **no** se registra sin su dependencia);
- que una clave inexistente lista las que existen;
- que no deja el nombre con versión y borra los `key-vN` viejos, si aplica;
- el render con un caso de cada trampa conocida del formato.

## Lista de control

- [ ] `origin: "skill"`, `additionalProperties: false`, `artifact_key`
- [ ] escribe sólo por `SkillStorage`
- [ ] condicionada al entorno si depende de algo instalado
- [ ] cortes por tiempo en todo lo externo
- [ ] errores que dicen qué hacer
- [ ] `ACCION_HUMANA`, [[Referencia de herramientas]] y [[Habilidades de producción]]
- [ ] `npm run typecheck && npm test`

## Fuentes

- `packages/tools/src/skills/index.ts` → `SkillStorage`, `OpcionesHabilidades`,
  `createSkillTools`, `crearSkill`, `buscarEntregable`, `revisarCifras`
- `packages/tools/src/types.ts` → `RegisteredTool`, `ok`, `fail`, `preview`
- `packages/tools/src/registry.ts` → `ToolRegistry.forRole`, `describe`
- `apps/server/src/exports.ts` → `ExportStore.forCompany`
- `apps/server/src/runtime.ts` → `companyRuntime`, `sembrarHerramientas`

## Ver también

- [[Habilidades de producción]] · [[Archivos de salida y permisos de borrado]] · [[Salida de la empresa]]
- [[Cómo agregar una herramienta]] · [[Catálogo de herramientas]]
