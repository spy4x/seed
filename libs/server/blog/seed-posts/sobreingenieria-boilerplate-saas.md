---
slug: sobreingenieria-boilerplate-saas
language: es
translationOf: over-engineering-a-saas-boilerplate
title: "Lo que hice mal en Seed v1: sobreingeniería en un boilerplate SaaS"
seoTitle: "Sobreingeniería en un boilerplate SaaS: lo que hice mal"
description: "Seed v1 cumplió la mitad de su hoja de ruta y casi nada de lo que usa una persona. Cómo se veía la sobreingeniería de un boilerplate SaaS en su código, y qué hace Seed ahora."
tldr:
  - "Seed v1 (2019 a 2022) marcó 33 de los 66 puntos de su hoja de ruta, y ninguno de los 17 del cliente web, el panel de administración, la PWA y la subida de archivos."
  - "Tenía 31 proyectos de Nx, 23 clases de mensajes CQRS y nueve servicios en la nube alrededor de tres tablas."
  - "Sobreingeniería es construir una funcionalidad de forma más complicada de lo que necesita. No es construir demasiadas funcionalidades."
  - "Seed hoy construye cada funcionalidad de punta a punta con una sola forma copiada, en un solo servidor, y tiene todas las funcionalidades de producto que v1 solo planeó."
topic: Cicatrices
intro: "Seed tuvo una primera versión, de 2019 a 2022, y le metí sobreingeniería. Así se veía en su hoja de ruta, sus commits y sus carpetas, y esto es lo que Seed hace distinto ahora."
relatedFeature: deploy
coverAlt: "Un alto andamio violeta levantado alrededor de un brote diminuto en una maceta, junto a una maceta sencilla donde una planta grande crece sola."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-07T09:00:00Z
newsletter: true
devto: false
---

¿Qué hice mal en Seed v1? Le metí sobreingeniería: levanté el andamio de un producto grande antes
que el producto. Su propia hoja de ruta lo muestra. De 66 puntos, 33 estaban marcados, y esa mitad
era sobre todo herramientas y fontanería del backend: un monorepo, reglas de lint estrictas, un
hook de pre-commit, clases base de CQRS, despliegues a Google Cloud. En la otra mitad quedaba casi
todo lo que usa una persona: grupos, pagos, actualizaciones en tiempo real, trabajo sin conexión,
subida de archivos y el panel de administración.

Este artículo es para desarrolladores que construyen su propio boilerplate SaaS, o su primer SaaS, y
sospechan que están puliendo el taller en vez de fabricar los muebles. Cada número sale del código:
v1 sigue en el repositorio como la etiqueta
[`v1-final`](https://github.com/spy4x/seed/tree/v1-final), y los comandos con los que conté están en
el [pull request](https://github.com/spy4x/seed/pull/823) que añadió este artículo. Ningún recuerdo
salió herido: solo conté.

## ¿Qué era Seed v1?

Una «full-stack startup monorepo template», en palabras de su README, con buenas prácticas desde el
primer día. Angular en el frontend, Nest.js y Prisma sobre PostgreSQL en el backend, Firebase para
el inicio de sesión, Google Cloud para ejecutarlo, Nx para sostenerlo todo y Yarn para instalarlo.
El primer commit es del 16 de junio de 2019 y el último del 23 de diciembre de 2022: 134 commits en
tres años y medio.

No se fue apagando. Se detuvo: 55 de esos commits llegaron en sus dos últimos meses, y luego nada,
hasta que Seed volvió a empezar con un historial nuevo el 26 de enero de 2026.

## ¿Qué prometía la hoja de ruta y qué se construyó?

La hoja de ruta del README marcaba cada punto como hecho o planeado. Su última actualización fue el
25 de noviembre de 2022:

| Sección de la hoja de ruta                 |  Hecho | Planeado |
| ------------------------------------------ | -----: | -------: |
| Entorno y organización del código          |      8 |        7 |
| Backend                                    |     14 |        5 |
| Base de datos                              |      3 |        1 |
| Frontend compartido (login, estado, tests) |      6 |        3 |
| Estilos                                    |      2 |        0 |
| PWA (sin conexión, push, instalable)       |      0 |        4 |
| Subida de archivos                         |      0 |        4 |
| Panel de administración                    |      0 |        3 |
| Cliente web (grupos, tiempo real, cuenta)  |      0 |        6 |
| **Total**                                  | **33** |   **33** |

Las suscripciones de Stripe estaban en Backend, planeadas. Una tabla de usuarios para el panel de
administración sí llegó en diciembre de 2022, después de la última actualización, así que esa se la
concedemos a v1.

Tres de las 33 marcas eran copias de seguridad automáticas, restaurar una copia y réplicas de
lectura. Cada una enlazaba a la documentación de Google Cloud SQL, y el documento de
infraestructura decía que la replicación estaba «not yet used». Estaba marcando los deberes que
hacía Google.

## ¿Adónde fue el trabajo?

Al taller. Los mensajes de commit llevan su tipo, y cuentan la historia mejor que yo:

- **52 de los 134 commits son de tipo `env` o `environment`**: configuración, herramientas, CI,
  actualizaciones y renombres. 31 son `feat`.
- **El primer commit que deja a una persona hacer algo** (una API básica de usuarios: registrarse,
  leer y actualizar su perfil) es el número 38, del 31 de mayo de 2021, casi dos años después del
  primero. Entre los 37 primeros hay 28 commits `environment`.
- **La CI se montó tres veces**: GitLab CI en julio de 2019, GitHub Actions en marzo de 2021 y
  Google Cloud Build en junio de 2021. La última hoja de ruta seguía poniendo CI/CD como planeado.
- **Cuatro renombres de apps y carpetas en dos días** en febrero de 2021, y un commit llamado
  «massive refactoring» un año después.

## ¿Cuánta estructura para tan pocos datos?

El esquema de base de datos de v1 tiene tres modelos: `User`, `UserDevice` y `Notification`.
Alrededor de ellos:

- **31 proyectos de Nx**: tres aplicaciones, dos aplicaciones de pruebas end-to-end y 26
  bibliotecas. Solo el inicio de sesión compartido del frontend eran cuatro bibliotecas: container,
  guards, state y UI.
- **65 archivos `index.ts`**, y 63 de ellos se limitan a reexportar otros archivos.
- **Una capa CQRS con sus propias clases base** sobre los buses de comandos, consultas y eventos,
  con 11 comandos, 5 consultas y 7 eventos, y 19 manejadores.
- **Nueve servicios en la nube** en el documento de infraestructura (Cloud Run, Cloud SQL, Cloud
  Tasks, Cloud Logging, Cloud IAM, Firebase Authentication, Hosting y Storage, y Sentry), y una guía
  de configuración marcada «WIP» que empezaba con pasos manuales.
- **104 paquetes de npm** en el `package.json` raíz, 50 de ellos dependencias de ejecución.

Para comparar: Seed hoy tiene 34 paquetes de workspace alrededor de 73 tablas. La estructura ahora
crece con los datos en lugar de esperarlos.

## ¿El problema era tener demasiadas funcionalidades?

No, y esta es la parte que quiero dejar clara. Sobreingeniería es construir una funcionalidad de
forma más complicada de lo que necesita: capas de más, protecciones para carreras rarísimas,
automatización que nadie ejecuta. No es «esta funcionalidad sobra». La lista de deseos de v1 estaba
bien. Seed hoy tiene todas las funcionalidades de producto que v1 solo planeó, y más: passkeys y
segundo factor, grupos con roles e invitaciones, cobro por miembro con Stripe, tiempo real, una app
que funciona sin conexión, almacenamiento de archivos, un panel de administración en su propio host
y nueve idiomas ([README](https://github.com/spy4x/seed#readme)).

Incluso sigue usando CQRS: comandos, consultas y eventos pasan cada uno por su propio bus, y cada
cambio de grupo escribe su evento en un outbox que vacía un worker. El patrón nunca fue el culpable.
Lo fue escribir cuatro bibliotecas de inicio de sesión antes de que existiera un solo grupo.

## ¿Qué hace Seed distinto ahora?

- **Una sola forma para cada funcionalidad.** Una funcionalidad nueva copia la de notas archivo por
  archivo, en un orden fijo: [todos los archivos del agregado de notas](/es/docs/aggregates). La
  guía lo dice sin rodeos: «Do not invent a second shape», no inventes una segunda forma.
- **Un servidor en lugar de nueve servicios.** Docker Compose ejecuta la app, Postgres, el proxy y
  la monitorización en un servidor que controlas:
  [de git clone a producción en un servidor de Hetzner](/blog/deploy-saas-to-one-hetzner-server)
  (en inglés).
- **Principios que dicen que no.** Los
  [principios de Seed](https://github.com/spy4x/seed/blob/main/docs/principles.md) incluyen «Ship
  small, safe slices», «Avoid speculative complexity» y «Add deps only with clear ROI»: entregar en
  trozos pequeños y seguros, no añadir complejidad por si acaso, y sumar una dependencia solo cuando
  compensa claramente.
- **Estándares web antes que frameworks.** Los servidores hablan Fetch, Web Crypto y WebSocket, no
  la API privada de una plataforma:
  [por qué Seed está construido sobre estándares web](/blog/why-seed-free-saas-starter-web-standards)
  (en inglés).

Los tipos de commit también cambiaron. De los 531 commits de Seed desde el reinicio, 194 son `feat`
y 46 son `chore`, `ci` o `build`. Casi todos son pull requests fusionados con squash, así que no
tienen el tamaño de los commits de v1, pero la dirección está clara.

## ¿Tu boilerplate está haciendo lo mismo?

Tres comprobaciones rápidas, sacadas de los números de v1:

1. Cuenta tus carpetas y tus tablas. Más bibliotecas que tablas es mala señal.
2. Lee la mitad «planeada» de tu hoja de ruta. Si ahí está todo lo que tocaría un usuario, estás
   construyendo el taller.
3. Busca el commit en el que una persona pudo hacer algo por primera vez. Si es el 38, hola, soy
   yo.

O sáltate el andamio: [Seed](https://github.com/spy4x/seed) es gratis y con licencia MIT, y sus
cimientos ya están construidos. Clónalo y
[lanza tu primera funcionalidad](/blog/your-first-feature-copy-the-notes-aggregate) esta semana (en
inglés).
