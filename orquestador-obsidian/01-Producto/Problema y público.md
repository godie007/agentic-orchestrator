---
tags: [producto]
aliases: [Para quién es, Público, Problema]
---

# Problema y público

## El problema

Automatizar trabajo de conocimiento con **un** agente choca contra cuatro muros:

1. **El contexto.** Un agente que tiene que vender, estimar, programar y revisar
   termina con un prompt imposible y decisiones mezcladas. Y cada vuelta de su
   loop reenvía todo: el costo crece con el cuadrado del largo del turno.
2. **El costo.** Si todo pasa por un modelo caro, lo rutinario se paga a precio
   de decisión ejecutiva.
3. **La opacidad.** Cuando algo sale mal no se ve *dónde*: el resultado es un
   bloque de texto, y el agente informa como hecho lo que no hizo.
4. **El resultado no es un entregable.** Un párrafo bien escrito no se manda a
   un cliente; una propuesta en Word, un video narrado o un cambio de código
   revisable, sí.

Y un quinto, que aparece apenas el agente toca algo real: **la confianza**. Un
agente que escribe en tu repo, corre comandos en tu máquina o toca tu teléfono
tiene que poder hacerlo sin poder romper lo que no le corresponde.

## Cómo lo aborda

| Muro | Respuesta |
|---|---|
| Contexto | un rol = un agente con prompt acotado, bandeja propia y sus herramientas; lo largo en un vault que se consulta; topes a lo que entra en un turno delegado ([[Organización de agentes]], [[Turnos delegados a un CLI]]) |
| Costo | modelo por rol y **escalado por dificultad** por turno; suscripciones de Claude y opencode por sus CLI ([[Capa LLM y tiers]], [[Escalado por dificultad]]) |
| Opacidad | un evento por paso, replay, `check_activity`, `estado_del_proceso`, auditoría procedimental ([[Observabilidad y trazas]], [[Auditoría de corridas]]) |
| Resultado | habilidades que producen archivos reales; código en una sesión revisable ([[Habilidades de producción]], [[Trabajo con código]]) |
| Confianza | frenos en el ejecutor, clon gestionado, sandbox, QA sólo en staging, publicar humano ([[Invariantes de arquitectura]], [[Seguridad]]) |

## Para quién es

**Equipos que producen entregables repetibles**: propuestas, informes, piezas
de marketing, material institucional, videos. Las plantillas de consultora,
estudio audiovisual, lanzamiento e investigación salen de ahí
([[Plantillas de equipo]]), y las [[Misiones programadas]] repiten un encargo con
aviso por correo.

**Quien mantiene un producto de software propio y quiere un equipo de agentes
sobre su repo**: un IDE con chat, vista previa de un monorepo (API, web, app
móvil), control de versiones al estilo de Cursor, y la app corriendo en su
teléfono con espejo, depuración y barridos de QA ([[El IDE]],
[[App móvil en el teléfono]]). El caso real que lo empujó es un monorepo con
backend Express, frontend Vite y app Expo.

**Quien quiere entender cómo se comporta un sistema multiagente antes de
construirlo.** El valor es poder **medir** un livelock, un agente que informa
mal, un modelo barato que se va por las ramas o un turno que se come 21 millones
de tokens de entrada. Casi todas las [[Trampas conocidas]] salieron de mirar
corridas reales.

## Para quién NO es

- **Producción multiusuario.** No hay autenticación de la herramienta; la API
  escucha en localhost y sólo le contesta a los orígenes de la app.
- **Autonomía sin supervisión.** Publicar, commitear, conectar servidores y
  ejecutar lo sensible es de una persona, a propósito.
- **Cargas grandes o de larga vida en un servidor.** Es un proceso local con
  SQLite y estado vivo en memoria: una corrida no sobrevive a un reinicio (su
  trabajo abierto sí se hereda).
- **Linux o Windows como plataforma principal del trabajo con código.** El
  sandbox de los comandos es el de macOS (`sandbox-exec`); en otra plataforma
  cada repo necesita el opt-in `sinAislamiento`.

## El costo real de usarlo

Con modelos gratuitos una corrida de 4 ciclos produjo un entregable coherente
por US$0,00. Con suscripción (Claude Code, opencode) el costo por token se
reporta en cero y el límite es la ventana de la suscripción. Con API, el tope
por corrida (`DEFAULT_RUN_BUDGET_USD`) es la red de contención. Ver
[[Costos y presupuesto]].

El gasto que más sorprende es el de **entrada**: el mismo documento entrando
once veces al contexto (534k tokens de entrada para 2k de salida), o seis
agentes con 21,1M de entrada para 132k de salida. De ahí salen el memo de
lecturas y los topes de los turnos delegados.

## Ver también

- [[Visión del producto]] · [[Estado del producto]] · [[Casos de uso]]
