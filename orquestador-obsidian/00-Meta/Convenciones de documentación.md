---
tags: [meta]
aliases: [Cómo se escribe esta bóveda, Estilo de la documentación]
---

# Convenciones de documentación

## Idioma

Todo en **español rioplatense**, igual que el código, los comentarios y la UI.
Un párrafo en inglés desentona con todo lo que lo rodea. Los identificadores de
código se dejan como están (`write_artifact`, `RunState`, `tool.selection`): son
nombres, no palabras.

## Una nota, un concepto

El nombre del archivo es el título: `Motor de agentes.md` abre con
`# Motor de agentes`. Obsidian resuelve los enlaces **por nombre**, así que dos
notas no pueden llamarse igual aunque vivan en carpetas distintas, y mover una
nota de carpeta no rompe nada.

## Frontmatter

Cada nota abre con:

```yaml
---
tags: [categoría, subcategoría]
aliases: [otro nombre con el que la buscarías, archivo.ts, símboloPrincipal]
---
```

**Categorías** (dicen en qué carpeta vive): `moc`, `meta`, `producto`,
`arquitectura`, `adr`, `capacidad`, `caso-de-uso`, `operación`, `referencia`,
`contribuir`.

**Subcategorías** (dicen de qué parte del sistema habla): `motor`, `llm`,
`proveedor`, `organización`, `producción`, `código`, `ide`, `móvil`,
`plataforma`, `servidor`, `frontend`, `pantalla`, `mcp`, `seguridad`, `dominio`.

En `aliases` van los nombres de archivo y los símbolos que alguien buscaría
(`loop.ts`, `runAgentTurn`): la búsqueda rápida de Obsidian los encuentra.

## Enlaces

- Enlace interno con `[[Nombre exacto de la nota]]` o `[[Nombre|texto]]`. Sin
  rutas.
- **No repitas lo que ya está en otra nota.** Enlazá. Si un concepto aparece en
  tres lugares, es señal de que merece su propia nota.
- Un enlace a una nota que todavía no existe es válido: marca algo que vale la
  pena escribir. Pero no dejes uno con un nombre inventado para algo que ya tiene
  nota: queda como un enlace roto que parece intencional.

## Anclaje al código

Toda afirmación técnica nombra su fuente, con la ruta relativa a la raíz del
repositorio y, cuando ayuda, el símbolo:

> El tier se resuelve contra el catálogo vivo del proveedor
> (`packages/llm/src/tiers.ts` → `resolveTier`).

Preferí el símbolo al número de línea: las líneas se corren con cada edición, el
nombre de una función no. Sin ese anclaje, la documentación envejece en silencio.
Con él, quien duda verifica en diez segundos.

Cada nota técnica cierra con `## Fuentes` (los archivos y símbolos de los que
sale) y `## Ver también` (los enlaces a las notas vecinas).

## Qué NO va en esta bóveda

La bóveda está **versionada en git** junto con el código.

- **Secretos.** Ninguna API key, ningún token, ningún valor de `.env`. Los
  ejemplos usan nombres de variable, nunca valores.
- **Datos de clientes reales.** Las empresas de ejemplo son ficticias.
- **Copias del código.** Un fragmento corto para ilustrar, sí; un archivo entero
  pegado, no: se desincroniza a la primera edición.
- **Historial de cambios.** Para eso está git. La excepción es el incidente
  medido que explica una regla ("lo pagamos con…"): ese sí se cuenta, porque es
  la razón de ser de la regla.

## Markdown que Obsidian lee bien

- **Línea en blanco antes de cada encabezado** (`##`, `###`) y antes de cada
  tabla, lista o bloque de código. Sin ella markdown no reconoce el encabezado y
  la nota sale como un bloque de texto plano, sin esquema.
- **Callouts** para lo que no hay que olvidar: `> [!danger]` para una trampa que
  ya costó algo, `> [!warning]`, `> [!note]`, `> [!tip]`.
- Lo que está entre comillas invertidas no es un enlace: `[[ejemplo]]` escrito
  como código se muestra tal cual.

## Diagramas

Mermaid, embebido en la nota. Obsidian los dibuja nativo y sobreviven a un
`grep`, cosa que una imagen no hace. `sequenceDiagram` para flujos entre
componentes, `flowchart` para decisiones, `graph` para estructuras,
`erDiagram` para el esquema de datos y `stateDiagram-v2` para estados.

## Estilo

Frases cortas. La razón antes que la regla: "se hace así **porque** pasó esto".
Una decisión sin su costo no se puede revisar más adelante — por eso los
[[Decisiones de arquitectura|ADR]] siempre incluyen qué se resignó.

## Cómo se verifica

Antes de dar por buena una tanda de cambios en la bóveda:

1. **Enlaces:** cada `[[…]]` fuera de código apunta a una nota que existe (o a
   una que se decidió escribir).
2. **Frontmatter y título:** toda nota tiene frontmatter y su `#` coincide con el
   nombre del archivo (salvo [[Inicio]]).
3. **Encabezados:** ninguno pegado a la línea anterior.
4. **Nombres únicos:** dos notas con el mismo nombre en carpetas distintas hacen
   ambiguos los enlaces.
5. **Secretos:** ningún valor con forma de token (hex largo, `sk-…`, `ghp_…`,
   `Bearer …`, JWT).

## Ver también

- [[Cómo navegar esta bóveda]]
- [[Glosario]]
- [[Inicio]]
