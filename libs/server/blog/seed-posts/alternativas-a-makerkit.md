---
slug: alternativas-a-makerkit
language: es
translationOf: makerkit-alternatives
title: "Alternativas a Makerkit: boilerplates SaaS gratis, y cuándo pagar"
seoTitle: "Alternativas a Makerkit: boilerplates SaaS gratis y open source"
description: "Makerkit cuesta desde 299 dólares, y su kit Lite gratis no trae cobros ni equipos. Alternativas gratis que traen ambos, cada dato con su fuente, y cuándo vale la pena Makerkit."
tldr:
  - Los kits de pago de Makerkit cuestan 299 o 599 dólares en un pago; el Lite gratis no trae cobros, equipos ni admin.
  - Un proyecto sobre un kit de pago no puede publicarse como open source, y un freelancer necesita una licencia por cliente.
  - Seed es gratis y MIT, con equipos, cobro por miembro y app de administración, en tu propio servidor.
  - Elige Makerkit si quieres Supabase, Next.js o React Router y sus herramientas para agentes de código.
topic: Preguntas
intro: "Makerkit es un kit de pago cuidado con una edición Lite gratis, y la diferencia entre ambos es justo lo que necesita un producto para equipos. Aquí van las alternativas gratis que la cubren, con una fuente para cada dato, y los casos en que pagar Makerkit es lo correcto."
relatedFeature: deploy
coverAlt: "Una gran caja de herramientas violeta abierta, con las bandejas llenas, junto a una pequeña caja gris cerrada con un candado."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-05T09:00:00Z
newsletter: false
---

La alternativa gratis a Makerkit que conserva lo que añaden sus kits de pago, es decir equipos,
cobros y un panel de administración, es Seed: un boilerplate con licencia MIT que trae grupos y
roles, cobro por miembro con Stripe y una app de administración en su propio dominio. El kit gratis
de Makerkit, Lite, deja fuera esas tres cosas. Para una base gratis más pequeña está el Next.js
SaaS Starter y, entre los de pago, Supastarter. Los kits de pago de Makerkit cuestan 299 o 599
dólares en un solo pago.

Yo hago Seed, tenlo en cuenta al leer. Cada dato sobre otro producto enlaza a su fuente, y leí cada
página el 4 de noviembre de 2026. ¿Algo cambió?
[Abre un issue](https://github.com/spy4x/seed/issues) y lo corrijo.

## ¿Qué trae Makerkit y qué le falta a Lite?

[Makerkit](https://makerkit.dev/) ofrece kits sobre tres capas de datos (Supabase; Drizzle con
Better Auth; Prisma con Better Auth) para Next.js 16, TanStack Start y, con Supabase, React Router
8. Su página principal lista inicio de sesión con contraseña, enlaces mágicos, passkeys opcionales,
OAuth y app autenticadora; cuentas de equipo con roles e invitaciones; suscripciones de Stripe
fijas, por asiento o por uso; un superadmin que puede entrar como un usuario o bloquearlo;
traducciones; blog y documentación, y notificaciones en tiempo real en los kits con Supabase. Para
agentes de código trae reglas, skills y un servidor MCP.

La [página de precios](https://makerkit.dev/pricing) muestra dos licencias de pago único, con
actualizaciones de por vida:

- **Pro**, 349 dólares, 299 en las tarjetas de los kits: un desarrollador, proyectos ilimitados.
- **Teams**, 649 dólares, 599 en las tarjetas: hasta cinco personas en el repositorio.

Lee las condiciones antes de comprar, porque dos sorprenden. Un freelancer necesita una licencia
aparte por cada cliente. Y un proyecto hecho sobre un kit de pago no puede publicarse como open
source: para eso la página te manda a Lite. En general no hay reembolsos una vez que tienes acceso,
así que la propia página aconseja probar Lite primero.

[Makerkit Lite](https://github.com/makerkit/nextjs-saas-starter-kit-lite) es gratis y MIT, con
unas 470 estrellas en GitHub: Next.js, inicio de sesión con Supabase, páginas de perfil, i18n y
páginas de marketing. Su README enumera lo que deja fuera, y esa lista es el corazón de un producto
para equipos: cobros, cuentas de equipo, plantillas de correo, el panel de superadmin, blog y
documentación.

## Comparativa: Makerkit frente a sus alternativas

| Boilerplate                                                               | Precio                                              | Licencia                              | Stack                                  | Equipos y cobros                | Hosting                                    |
| ------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------- | -------------------------------------- | ------------------------------- | ------------------------------------------ |
| [Makerkit](https://makerkit.dev/pricing)                                  | 299 o 599 USD en un pago (precio de lista 349, 649) | De pago, sin open source, por cliente | Next.js, React Router o TanStack Start | Sí, por asiento                 | Recomienda Vercel; Cloudflare, Docker, VPS |
| [Makerkit Lite](https://github.com/makerkit/nextjs-saas-starter-kit-lite) | Gratis                                              | MIT                                   | Next.js, Supabase                      | No                              | No figura                                  |
| [Seed](https://github.com/spy4x/seed)                                     | Gratis                                              | MIT                                   | Hono, Preact; Postgres                 | Sí, por miembro                 | Tu propio servidor, Docker Compose         |
| [Supastarter](https://supastarter.dev/)                                   | 349, 799 o 1499 USD en un pago                      | De pago, sin redistribución           | Next.js, Nuxt o TanStack Start         | Sí, por asiento                 | Vercel, Docker, Coolify y otros            |
| [Next.js SaaS Starter](https://github.com/nextjs/saas-starter)            | Gratis                                              | MIT                                   | Next.js, Drizzle; Postgres             | Owner y Member; Stripe Checkout | Vercel                                     |

La fila de hosting de Makerkit sale de su
[checklist de producción](https://makerkit.dev/docs/next-supabase-turbo/going-to-production/checklist),
que recomienda Vercel y avisa de que Docker o un VPS piden "más configuración". La
[página de comparación](/es/compare) alinea 19 funciones de seis boilerplates.

## ¿Y los cobros si estás en Latinoamérica?

Según la [lista de países de Stripe](https://stripe.com/global), consultada el 4 de noviembre de
2026, Stripe admite empresas de España y México, pero Argentina y Colombia no aparecen. Seed cobra
solo con Stripe. La página principal de Makerkit nombra además Polar, que se presenta como
[merchant of record](https://polar.sh/); comprueba con Polar si trabaja con tu país. Seed, en
cambio, habla español en la app, el panel, el sitio y los correos.

## ¿Qué alternativa gratis tiene lo que le falta a Makerkit Lite?

**Seed** tiene las tres piezas. Cada persona recibe un grupo al registrarse, con roles de lector,
editor, administrador y propietario. Stripe cobra por miembro, con un plan gratis, 14 días de prueba
y un periodo de gracia tras un pago fallido. Una app de administración en su propio dominio
encuentra a una persona, devuelve un pago y anota cada acción en un registro de auditoría. Inicio de
sesión con contraseña, passkeys, códigos por correo, Google y GitHub, y una app autenticadora como
segundo factor. Y suma lo que ninguna página de Makerkit menciona: una app que abre sin conexión y
deja en cola los cambios, y monitorización del servidor (VictoriaMetrics, Grafana) y copias de
seguridad en el archivo Compose.

Como Seed es MIT, las dos sorpresas de la licencia no existen: publica tu producto como open source
o construye diez proyectos de clientes encima, y nadie necesita una segunda licencia. Yo mismo hago
los MVP de mis clientes sobre Seed, así que no es teoría.

**El Next.js SaaS Starter**, unas 16 300 estrellas, queda entre Lite y los kits de pago: equipos
con Owner y Member, Stripe Checkout y Customer Portal sobre Next.js, Drizzle y Postgres, sin panel
de administración.

## ¿Cuánto cuesta el hosting aparte?

La checklist de Makerkit recomienda Vercel, y su kit principal corre sobre Supabase. Ese par se
paga cada mes, por asiento de desarrollador y por base de datos. Seed corre en un solo servidor que
alquilas. Elige servidor y tamaño de equipo:

<HostingCost server="cx23" developers={1} />

Con un desarrollador, Seed en el CX23 cuesta 12,48 € al mes, frente a 45 dólares de Vercel Pro y
Supabase Pro. No es una comparación exacta: el par gestionado actualiza, escala y respalda por ti.
Cómo poner Seed en un servidor: la [guía de despliegue](/es/docs/deploy).

## ¿Cuándo vale la pena pagar Makerkit?

- **Quieres Supabase.** El kit principal de Makerkit se apoya en su autenticación, su
  almacenamiento y su row-level security. Seed usa su propio Postgres y su propio inicio de sesión.
- **Quieres Next.js o React Router.** Seed es Preact en todas partes, también en el sitio público.
- **Necesitas entrar como un usuario, cobro por uso o un segundo proveedor de pagos.** Makerkit
  lista los dos primeros y su página principal nombra Polar junto a Stripe. Seed no tiene ninguno
  de los tres; Stripe es su único proveedor.
- **Trabajas con agentes de código.** Makerkit trae un servidor MCP y skills. Seed tiene
  [instrucciones para agentes](/es/docs/ai-agents), pero no servidor MCP
  ([#211](https://github.com/spy4x/seed/issues/211)).
- **Quieres un mantenedor con trayectoria.** Makerkit dice que se mantiene a tiempo completo desde
  2022. Seed es joven y tiene un solo mantenedor: yo.

## ¿Cómo pruebo Seed antes de decidir?

Abre la [demo en vivo](https://app.seedsaas.com): un clic abre una cuenta de invitado con datos de
ejemplo, y en dos minutos creas un equipo, invitas a alguien y abres los cobros. Luego clona
[el repositorio](https://github.com/spy4x/seed). Y si Makerkit te encaja mejor, empieza por Lite,
como aconseja su propia página de precios. Más opciones:
[alternativas a Supastarter](/es/blog/alternativas-a-supastarter).
