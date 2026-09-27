---
tags: [meta]
aliases: [Navegación, Estructura de la bóveda, Recorridos]
---

# Cómo navegar esta bóveda

Esta carpeta es una **bóveda de Obsidian**: abrila con `Archivo → Abrir bóveda →
Abrir carpeta como bóveda` apuntando a `orquestador-obsidian/`. Funciona igual
como carpeta de markdown en cualquier editor, pero perdés el grafo, la búsqueda
por alias y los enlaces `[[...]]` navegables.

## Estructura

```
orquestador-obsidian/
├── Inicio.md                    ← el mapa principal, empezá acá
├── 00-Meta/                     cómo se escribe y se lee esta documentación
├── 01-Producto/                 qué es, para quién, en qué estado, hacia dónde va
├── 02-Arquitectura/             cómo está construido y por qué
│   ├── ADR/                     decisiones con su contexto y su costo
│   ├── Proveedores LLM/         un adaptador por nota
│   └── Pantallas/               una pantalla de la UI por nota
├── 03-Capacidades/              qué sabe hacer el sistema
│   ├── Organización/            roles, coordinación, aprobaciones, memoria, entregables
│   ├── Producción/              documentos, deck, video, audio, imágenes
│   ├── Código/                  repos, sesiones, herramientas de código, IDE, chat
│   ├── Móvil/                   teléfono, espejo, depuración, QA, builds, R2
│   └── Plataforma/              herramientas, MCP, proyectos, misiones, trazas
├── 04-Casos-de-uso/             recorridos completos de punta a punta
├── 05-Operación/                instalar, configurar, correr, diagnosticar
├── 06-Referencia/               tablas para consultar, no para leer de corrido
└── 07-Contribuir/               cómo extenderlo sin romper nada
```

Cada subcarpeta de `03-Capacidades/` tiene una nota que hace de puerta:
[[Organización de agentes]], [[Habilidades de producción]], [[Trabajo con código]],
[[App móvil en el teléfono]] y [[Catálogo de herramientas]].

## Los recorridos

**Comprensión** (para entender el sistema entero):
[[Visión del producto]] → [[Arquitectura general]] → [[Modelo de dominio]] →
[[Scheduler y ciclo de una corrida]] → [[Motor de agentes]] →
[[Organización de agentes]] → [[Observabilidad y trazas]] → [[Casos de uso]].

**Operación** (para ponerlo a correr):
[[Instalación y arranque]] → [[Dependencias del sistema]] →
[[Variables de entorno]] → [[Comandos]] → [[Empresas de ejemplo]] →
[[Diagnóstico de problemas]].

**Programar con agentes** (para usar la pestaña Código):
[[Trabajo con código]] → [[Repositorios y sesiones]] → [[El IDE]] →
[[Chat de IA]] → [[Control de versiones y publicación]] →
[[CU-06 Pedido de código desde el chat]].

**App móvil** (para trabajar con un teléfono vinculado):
[[App móvil en el teléfono]] → [[Vinculación del teléfono]] →
[[Espejo del teléfono]] → [[Depuración de la app móvil]] → [[QA móvil]] →
[[Build de producción Android]].

**Contribución** (antes de la primera línea de código):
[[Invariantes de arquitectura]] → [[Trampas conocidas]] →
[[Guía de contribución]] → el how-to que corresponda en `07-Contribuir/`.

**Consulta puntual** (un dato, no una explicación):
[[Referencia de API]] · [[Referencia de API de código y móvil]] ·
[[Referencia de esquemas]] · [[Referencia de eventos]] ·
[[Referencia de herramientas]] · [[Variables de entorno]] · [[Glosario]].

## Relación con los archivos del repo

Esta bóveda **no reemplaza** dos archivos que viven en la raíz del repositorio:

| Archivo | Qué cubre | Relación |
|---|---|---|
| `README.md` | pitch del producto y estado, orientado a quien lo evalúa | esta bóveda lo expande en [[Visión del producto]] y [[Estado del producto]] |
| `CLAUDE.md` | instrucciones operativas para agentes de código que trabajan sobre el repo | esta bóveda lo estructura en [[Invariantes de arquitectura]], [[Trampas conocidas]] y en la nota de cada capacidad |

Cuando haya conflicto, **manda el código**. Cada nota técnica nombra los archivos
fuente de los que sale, para que puedas verificar en lugar de creer.

Tampoco hay que confundirla con el **vault de contexto de cada empresa**
(`data/contexto/<empresa>/`), que es lo que *los agentes* saben de su negocio y
escriben ellos mismos: ver [[Vault de contexto]]. Esta bóveda documenta el
sistema; aquel es memoria de trabajo de una empresa.

## Cómo mantenerla

Ver [[Convenciones de documentación]]. La regla corta: una nota por concepto,
enlaces `[[...]]` en vez de repetir, y ningún dato que el código pueda
contradecir sin que la nota diga de dónde salió.
