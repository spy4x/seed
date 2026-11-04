---
slug: seed-ya-esta-aqui-recorrido
language: es
translationOf: welcome-to-the-seed-blog
title: "Seed ya está aquí: recorrido por el starter SaaS gratis, pantalla a pantalla"
seoTitle: "Seed ya está aquí: el starter SaaS gratis, pantalla a pantalla"
description: Seed, un starter SaaS gratis con licencia MIT, ya se puede usar. Qué funciona desde el primer día, qué falta todavía y cómo probarlo en un minuto.
tldr:
  - Seed es un starter SaaS gratis con licencia MIT que ya puedes usar. Copias un repositorio y todo el código es tuyo.
  - "Ya hecho: passkeys y 2FA, grupos con roles, cobro por miembro con Stripe, tiempo real, modo sin conexión, panel de administración y nueve idiomas."
  - "Todavía no: las apps de Android y de escritorio."
  - La demo se abre con un clic, y en local arranca con cuatro comandos.
topic: Seed
intro: "Seed, el starter SaaS gratis que construyo en público, ya se puede usar. Te enseño lo que tienes desde el primer día, pantalla a pantalla, lo que falta y cómo probarlo en un minuto."
coverAlt: "Un brote violeta en una maceta junto a un sobre abierto del que salen hojas volando como si fueran cartas."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-01T09:00:00Z
newsletter: false
---

Seed ya está aquí. Es un starter SaaS gratis, con licencia MIT, que puedes usar hoy: copias un
repositorio y empiezas con inicio de sesión, grupos con roles, cobro por miembro con Stripe,
actualizaciones en tiempo real, una app que funciona sin conexión, un panel de administración y
nueve idiomas ya funcionando. Corre sobre Postgres y Docker Compose en un único servidor que
controlas tú, y puedes recorrer la app en la [demo en vivo](https://app.seedsaas.com) antes de
instalar nada.

Soy Anton y desarrollo MVP de SaaS para clientes. Todos empezaban con el mismo mes de fontanería:
login, equipos, cobros y un panel de administración que siempre prometía mejorar «más adelante».
Seed es ese mes, hecho una vez y mantenido al día. Esto es el recorrido; si buscas una comparación
con otras opciones, está en
[¿Existe un boilerplate SaaS gratis y de código abierto?](/es/blog/boilerplate-saas-gratis).

## ¿Cómo inicia sesión la gente?

De todas las formas que espera: correo y contraseña con código de confirmación, passkeys, Google y
GitHub, y códigos de acceso por correo. La verificación en dos pasos con una app de autenticación se
activa con un interruptor en la página de seguridad, y en esa misma página aparecen todos los
dispositivos con sesión iniciada, para cerrar la que no reconozcas. Un visitante también puede
entrar como invitado con un clic y añadir un método de acceso más tarde, sin perder nada.

![La página de seguridad de un perfil: la contraseña, un botón Añadir una llave de acceso, la verificación en dos pasos activada y el principio de la lista de dispositivos con sesión iniciada.](/shots/profile-security-dark-800.webp)

Nadie se ha suscrito nunca a un producto porque el «olvidé mi contraseña» funcionara. Muchos se han
ido porque no funcionaba. Cómo está hecho sin pagar un servicio de autenticación:
[Passkeys, 2FA and sessions without an auth SaaS](/blog/passkeys-2fa-sessions-without-auth-saas)
(en inglés).

## ¿Cómo funcionan los equipos?

Con grupos. El registro crea la cuenta, la sesión y un primer grupo en una sola transacción de base
de datos, así que un espacio personal y un equipo son lo mismo, con las mismas reglas. Se invita a
la gente por correo con uno de cuatro roles: lector, editor, administrador o propietario. El
propietario puede ceder el grupo, y un grupo borrado se puede restaurar durante 30 días.

![Los miembros de un grupo, cada uno con su rol, un botón para invitar a gente y el menú de un miembro abierto: «Cambiar a lector», «Cambiar a administrador», «Quitar del grupo».](/shots/group-members-dark-800.webp)

## ¿Cómo se cobra?

Suscripciones de Stripe por grupo, cobradas por miembro. El catálogo de la demo tiene un plan
gratis (hasta 3 miembros y 10 notas) y un plan Pro de 9 € al mes por miembro, propietario incluido,
con 14 días de prueba. La cantidad sigue al número de miembros, el propietario confirma el nuevo
precio antes de cada invitación y un pago fallido abre un periodo de gracia en vez de un bloqueo
inmediato. Los precios son de ejemplo: tus planes son una lista en un archivo
([planes](/docs/billing-plans), en inglés).

![El plan de un grupo de ejemplo en la app de demo, con los precios de ejemplo de la demo: plan Pro con su fecha de renovación, 36,00 € al mes, para 4 miembros a 9,00 € cada uno, propietario incluido.](/shots/billing-plan-dark-780.webp)

Un equipo de cuatro paga 36 € al mes en Pro. Mueve el control para ver cuánto pagaría el tuyo.

<CostCalculator members={4} />

## ¿Qué pasa si dos personas editan a la vez, o se cae el wifi?

Los cambios llegan a todas las pestañas abiertas por WebSocket, y cuando el socket no está, las
llamadas van por HTTP normal. La app se instala, abre sin red, lee las últimas notas y grupos de
IndexedDB y guarda en cola los cambios en notas hasta que vuelve la conexión. Si alguien cambió la
misma nota mientras tanto, ves un conflicto que resolver, nunca una sobrescritura silenciosa del
trabajo de un compañero.

![La página Notas de un equipo llamado Acme Studio: seis notas con sus autores, etiquetas de colores y fecha de cambio, un buscador, filtros por etiqueta y autor y un botón Nueva nota.](/shots/notes-dark-800.webp)

Notas es la funcionalidad de referencia: tu primera funcionalidad la copia archivo por archivo
([tu primera funcionalidad](/blog/your-first-feature-copy-the-notes-aggregate), en inglés).
Los detalles, en inglés:
[tiempo real por WebSocket con HTTP de respaldo](/blog/realtime-websocket-with-http-fallback) y
[cómo se sincroniza la base de datos local](/blog/offline-first-preact-signals-local-database-sync).

## ¿Qué ve el operador?

Un panel de administración en su propio dominio. El operador busca a una persona, ve sus métodos de
acceso, sesiones y grupos, devuelve un pago, escribe este blog, gestiona los suscriptores del
boletín y relanza una tarea fallida. Las acciones arriesgadas piden confirmación, y cada acción
queda en un registro de auditoría.

![La página Usuarios del panel de administración: búsqueda por nombre o dirección, filtros por estado, tipo de cuenta y rol, y una tabla de personas inventadas con su rol, su estado y cuándo se las vio por última vez.](/video/admin-panel-poster-1280.webp)

Cada funcionalidad de la app recibe su pantalla en el panel en el mismo cambio, así que nunca se
desincronizan ([cómo el panel se mantiene al día](/blog/admin-panel-for-every-feature), en inglés).

## ¿Qué idiomas habla?

Nueve: español, inglés, alemán, francés, portugués de Brasil, ruso, japonés, chino simplificado y
árabe, que se lee de derecha a izquierda. Cambian la app, el panel, esta web y los correos, así que
puedes probar tu diseño en árabe antes de que tu primer cliente árabe encuentre el fallo por ti
([nueve idiomas y RTL desde el primer día](/es/blog/nueve-idiomas-y-rtl-desde-el-primer-dia)).

## ¿Qué falta todavía?

La app de Android ([#202](https://github.com/spy4x/seed/issues/202)) y la de escritorio
([#203](https://github.com/spy4x/seed/issues/203)). El resto del plan está en las
[issues abiertas](https://github.com/spy4x/seed/issues). El inicio de sesión con Google y GitHub y la
facturación con Stripe necesitan tus propias claves, por eso están desactivados en la demo, que
muestra pagos inventados en lugar de reales. El panel de administración tampoco forma parte de la
demo: [lo muestra un vídeo](/es/admin).

Y Seed no sirve para todo. Si despliegas en funciones serverless o quieres un backend alojado, elige
otra cosa: Seed cuenta con un servidor que gestionas tú.

## ¿Cómo lo pruebo?

Dos caminos, un minuto cada uno:

- **La demo en vivo.** «Pruébala sin cuenta» abre una cuenta de invitado llena de datos de ejemplo:
  un grupo tuyo y dos equipos de gente inventada. Se borra cada noche, así que rompe lo que quieras.
- **En tu máquina.** Deno 2 y Docker, y luego cuatro comandos. La guía
  [Get started](/docs/get-started) los explica paso a paso, y
  [el post de instalación](/blog/install-seed-and-run-it-locally) muestra la salida real y los
  tropiezos habituales (ambos en inglés).

Empieza por la demo: [ábrela ahora](https://app.seedsaas.com), pulsa «Pruébala sin cuenta» y
cotillea un equipo que no es el tuyo.
