---
slug: boilerplate-saas-gratis
language: es
translationOf: free-saas-boilerplate
title: ¿Existe un boilerplate SaaS gratis y de código abierto? Siete opciones comparadas
seoTitle: "Boilerplate SaaS gratis: 7 starters de código abierto"
description: Sí. Seed, Open SaaS, Next.js SaaS Starter, ixartz, Apptension, BoxyHQ y Makerkit Lite son gratis y abiertos. Qué trae cada uno y qué hacer si Stripe no llega a tu país.
tldr:
  - Sí, hay varios boilerplates SaaS gratis y de código abierto, con login, pagos y panel incluidos.
  - Las ediciones gratis de los kits de pago suelen dejar fuera justo los pagos o los equipos.
  - Stripe funciona en España y México, pero no en Argentina, Colombia, Chile ni Perú. Mira eso antes de elegir.
  - Seed trae grupos con roles, cobro por miembro con Stripe, panel de administración y nueve idiomas en tu propio servidor.
topic: Preguntas
intro: "Busqué un boilerplate SaaS gratuito como lo harías tú y encontré siete que no cuestan nada. Cada uno deja fuera algo distinto, así que comparé lo que de verdad obtienes antes de que le dediques tu tiempo."
coverAlt: "Siete plantas jóvenes en macetas de semillero sobre un estante de madera, tras una puerta de jardín abierta."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-03T09:00:00Z
newsletter: false
---

Sí: hay varios boilerplates SaaS gratis y de código abierto, y los buenos ya traen login, pagos y
un panel. A 3 de noviembre de 2026, Seed, Open SaaS, el Next.js SaaS Starter de Vercel, ixartz
SaaS Boilerplate, Apptension SaaS Boilerplate, BoxyHQ SaaS Starter Kit y Makerkit Lite tienen
licencia MIT o Apache-2.0. La diferencia está en lo que cada uno deja fuera, y en si su pasarela
de pago funciona donde tú facturas.

Yo hago Seed, así que no soy neutral. Cada dato sobre otro proyecto enlaza a la página donde lo
leí el 3 de noviembre de 2026, y cuando otra plantilla te conviene más, lo digo.

## ¿Qué boilerplates SaaS gratis hay?

| Plantilla                          | Licencia   | Stack                        | Equipos y roles                      | Pagos                           | Dónde corre                                       |
| ---------------------------------- | ---------- | ---------------------------- | ------------------------------------ | ------------------------------- | ------------------------------------------------- |
| [Seed][seed]                       | MIT        | Deno, Hono, Preact, Postgres | Grupos: lector, editor, admin, dueño | Stripe, por miembro             | Docker Compose en cualquier servidor Linux tuyo   |
| [Open SaaS][opensaas]              | MIT        | Wasp: React, Node.js, Prisma | No mencionados                       | Stripe, Polar o Lemon Squeezy   | Fly.io o Railway con un comando, o cualquier host |
| [Next.js SaaS Starter][next]       | MIT        | Next.js, Postgres, Drizzle   | Owner y Member                       | Stripe                          | Vercel, según su guía                             |
| [ixartz SaaS Boilerplate][ix]      | MIT        | Next.js, Drizzle, Clerk      | Organizaciones con roles, vía Clerk  | No en la edición gratis         | No indicado                                       |
| [Apptension SaaS Boilerplate][app] | MIT        | React, Django, Postgres      | Tenants: Owner, Admin, Member        | Stripe                          | AWS, con AWS CDK                                  |
| [BoxyHQ SaaS Starter Kit][boxy]    | Apache-2.0 | Next.js, Prisma, Postgres    | Equipos con roles                    | Suscripciones Stripe por equipo | Botones de Vercel, Heroku y DigitalOcean          |
| [Makerkit Lite][mk]                | MIT        | Next.js, Supabase            | No en Lite                           | No en Lite                      | Cualquier host con Next.js                        |

«No mencionados» quiere decir que la página del proyecto no lo nombra. No prueba que falte, pero
tampoco cuentes con ello.

## ¿Y si Stripe no funciona en tu país?

Casi todos los kits de la tabla cobran con Stripe, y Stripe [está disponible][stripe-global] en
España y México, pero no en Argentina, Colombia, Chile ni Perú (comprobado el 3 de noviembre de
2026). Si tu empresa está en uno de esos países, tienes tres caminos:

- **Open SaaS**, que además de Stripe trae Polar y Lemon Squeezy. Ambos son «merchant of record» ([Polar][polar], [Lemon Squeezy][lemon]): venden
  en tu nombre y se encargan de los impuestos. Revisa en sus páginas si aceptan vendedores de tu
  país antes de decidir.
- **Una empresa en un país con Stripe**, por ejemplo en Estados Unidos o España. Entonces Seed y
  los demás funcionan tal cual.
- **Tu propia pasarela**, como Mercado Pago, en lugar de Stripe. En Seed el código de cobro vive
  sobre todo en el módulo billing, descrito en [docs/billing.md][billing], pero cambiar de pasarela
  sigue siendo trabajo de días.

Seed solo cobra con Stripe hoy. Si eso te deja fuera, Open SaaS es mejor punto de partida para ti,
y prefiero decírtelo ahora que después de que montes tu MVP.

## ¿Cuándo conviene otra plantilla?

- **Next.js SaaS Starter**, si quieres una base pequeña en Next.js que se lee en una tarde.
- **ixartz**, si te sirve Clerk para el login y quieres equipos y traducciones gratis; los pagos
  llegan en sus ediciones de pago Plus, Pro y Max.
- **Apptension**, si tu equipo trabaja con Python y Django: login con segundo factor, passkeys,
  SSO, tres roles, Stripe y panel de administración.
- **BoxyHQ**, si vendes a empresas grandes que piden SAML SSO y SCIM desde el primer día.
  También trae suscripciones Stripe por equipo.

## ¿Qué trae Seed?

Seed está pensado para un producto que pagan equipos, en un servidor que controlas tú. En `main`
hoy: login con contraseña, passkeys, Google, GitHub y enlace por correo, segundo factor con app de
autenticación, grupos con cuatro roles e invitaciones, cobro por miembro con Stripe con plan gratis
y 14 días de prueba, panel de administración en su propio dominio, almacenamiento de archivos,
notificaciones en la app, por web push y por Telegram, app que funciona sin conexión y nueve
idiomas, español incluido.

Sus límites, sin rodeos: solo Stripe, servidores en Deno 2 (Node y Bun están
[en el plan][runtime], sin fecha), nada de serverless, y un único mantenedor, que soy yo.

## ¿Por dónde empiezo?

Responde dos preguntas: ¿te paga una persona o un equipo?, ¿y con qué pasarela puedes cobrar desde
tu país? Con eso la tabla se reduce a una o dos opciones. Si la respuesta es «equipos y Stripe»,
prueba la [demo](https://app.seedsaas.com) en español, mira la
[comparación con kits de pago](/es/compare) y arranca desde el [repositorio][seed].

[seed]: https://github.com/spy4x/seed
[billing]: https://github.com/spy4x/seed/blob/main/docs/billing.md
[runtime]: https://github.com/spy4x/seed/issues/623
[opensaas]: https://github.com/wasp-lang/open-saas
[next]: https://github.com/nextjs/saas-starter
[ix]: https://github.com/ixartz/SaaS-Boilerplate
[app]: https://github.com/apptension/saas-boilerplate
[boxy]: https://github.com/boxyhq/saas-starter-kit
[mk]: https://github.com/makerkit/nextjs-saas-starter-kit-lite
[stripe-global]: https://stripe.com/global
[polar]: https://polar.sh
[lemon]: https://www.lemonsqueezy.com
