---
tags: [caso-de-uso, moc]
aliases: [Casos de uso, CU, Recorridos]
---

# Casos de uso

Recorridos completos, de punta a punta. Cada uno nombra qué hace falta configurar,
qué se ve en pantalla y qué puede salir mal.

## Una empresa de agentes

| # | Caso | Empresa | Qué demuestra |
|---|---|---|---|
| [[CU-01 Propuesta comercial]] | un encargo comercial descompuesto y delegado entre direcciones | Codytion S.A. (`db:seed`) | coordinación, jerarquía, entregable en Word y PDF |
| [[CU-04 Control de calidad entre agentes]] | un revisor que contrasta el entregable contra su fuente | Codytion S.A. | `check_activity`, `in_review`, falsos positivos |
| [[CU-11 Proyecto nuevo desde una plantilla]] | un proyecto que nace con un equipo probado | cualquiera | plantillas, siembra de herramientas, faltantes nombradas |
| [[CU-12 Refutar una lección falsa]] | sacar del prompt una lección equivocada sin perder su registro | cualquiera | memoria gobernada, evidencia, refutación |
| [[CU-03 Misión semanal con aprobación humana]] | un encargo que se dispara solo, avisa por correo y espera | cualquiera | misiones, correo, publicar |

## Producción audiovisual

| # | Caso | Empresa | Qué demuestra |
|---|---|---|---|
| [[CU-02 Video institucional]] | de un guion en markdown a un `.mp4` narrado y un deck | Codytion (`db:estudio`) | guion, motor estudio, revisión antes de filmar |
| [[CU-09 Tutorial filmado sobre una app real]] | una pieza con clips reales de una aplicación en staging | INSPIA — Publicidad (`db:inspia-publicidad`) | motor de clips, sesión de navegador, QA con ojos |

## Código y app móvil

| # | Caso | Empresa | Qué demuestra |
|---|---|---|---|
| [[CU-06 Pedido de código desde el chat]] | un cambio puntual pedido al Mejorador de código | cualquiera con un repo cargado | corrida enfocada, arriendo, instantáneas, ver cambios y deshacer |
| [[CU-07 Barrido de QA en el teléfono]] | probar una funcionalidad en el teléfono real, con evidencia | proyecto con app móvil | QA móvil, `manejar_app`, verificación en base, API y R2 |
| [[CU-08 Release de la app Android]] | AAB para Play o APK para instalar, verificados | proyecto con app de Expo | build de producción, firma, `versionCode`, bundle apuntando a producción |

## Integraciones

| # | Caso | Empresa | Qué demuestra |
|---|---|---|---|
| [[CU-05 Conectar un servidor MCP]] | sumar herramientas externas pegando su configuración | cualquiera | Hub MCP, secretos por referencia, matriz de accesos, probador |
| [[CU-10 Instalar un servidor desde la tienda]] | Brave Search en un click, usado por la corrida en curso | cualquiera | tienda MCP, otorgar herramientas, llegar a la corrida viva |

## Antes de cualquiera

```bash
npm install
cp .env.example .env      # al menos una credencial de proveedor
npm run check:llm         # ¿el proveedor contesta?
npm run dev               # servidor :3001 + UI :5173
```

Ver [[Instalación y arranque]] y [[Dependencias del sistema]] (los casos de video,
código y móvil necesitan herramientas instaladas en la máquina).

> [!warning] Corré `check:llm` antes de una corrida larga
> Una cuenta sin crédito contesta **402 a todo**, y eso se ve como una corrida que
> muere a los pocos ciclos sin producir nada. Ver [[Diagnóstico de problemas]].

## Cómo leer estos casos

Cada uno sigue, en líneas generales, la misma estructura:

1. **Qué se quiere lograr**, en una frase.
2. **Configuración**: empresa, roles, herramientas, políticas.
3. **El recorrido**, paso a paso, con lo que se ve en pantalla.
4. **Qué mirar**: dónde se nota que el sistema hizo lo correcto.
5. **Qué puede salir mal**, con el enlace al diagnóstico.

## Ver también

- [[Empresas de ejemplo]] — las empresas sembradas
- [[Comandos]]
- [[Diagnóstico de problemas]]
