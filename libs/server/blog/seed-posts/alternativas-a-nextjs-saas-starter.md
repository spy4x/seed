---
slug: alternativas-a-nextjs-saas-starter
language: es
translationOf: nextjs-saas-starter-alternatives
title: "Alternativas a Next.js SaaS Starter: qué usar cuando se te queda corto"
seoTitle: "Alternativas a Next.js SaaS Starter, gratis y de pago"
description: "Next.js SaaS Starter es gratis y pequeño a propósito: sin restablecer contraseña ni correos de invitación. Alternativas con más incluido, gratis y de pago."
tldr:
  - Next.js SaaS Starter es gratis y MIT, con equipos de propietario y miembro y Stripe Checkout.
  - No envía ningún correo, así que invitaciones, restablecer contraseña y verificar el correo te tocan a ti.
  - Gratis y con todo eso hecho está Seed; para seguir en Next.js con más incluido, Makerkit o Supastarter.
  - Quédate con el starter si quieres un código pequeño para aprender o hacer el acceso a tu manera.
topic: Preguntas
intro: "Next.js SaaS Starter es una base limpia y pequeña, y su propio README dice que es para aprender. Esto es lo que le falta y qué plantilla elegir cuando necesitas esas partes ya hechas."
relatedFeature: sign-in
coverAlt: "Un pequeño armazón de madera alrededor de un solo brote, delante de un invernadero de cristal terminado y lleno de plantas violetas."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-06T09:00:00Z
newsletter: false
---

Next.js SaaS Starter es una plantilla gratuita con licencia MIT: acceso con correo y contraseña,
Stripe Checkout y equipos con roles de propietario y miembro. Su README la llama minimalista a
propósito, un recurso para aprender. Las alternativas sirven cuando quieres más hecho: Seed es
gratis y MIT, con invitaciones, restablecer contraseña, passkeys y cobro por miembro, y Makerkit y
Supastarter son plantillas de pago que te mantienen en Next.js.

Yo hago Seed, tenlo en cuenta al leer. Cada dato sobre otro producto enlaza a su fuente, y los
comprobé el 4 de noviembre de 2026. ¿Algo desactualizado?
[Abre un issue](https://github.com/spy4x/seed/issues) y lo corrijo.

## ¿Qué trae Next.js SaaS Starter?

[Next.js SaaS Starter](https://github.com/nextjs/saas-starter) vive en la organización de Next.js
en GitHub, y la mayoría de sus commits son de Lee Robinson. Tiene unas 16.250 estrellas. Su README
incluye:

- una landing y una página de precios que abre Stripe Checkout;
- acceso con correo y contraseña, con JWT en cookies;
- un panel con equipos y roles de propietario y miembro;
- gestión de la suscripción en el Customer Portal de Stripe;
- un registro de actividad de los usuarios.

El stack es Next.js, Postgres con Drizzle y shadcn/ui. Se lee entero en una tarde, y esa es la
idea.

## ¿Qué le falta?

No envía correos. Su `package.json` no tiene librería de correo, e invitar a un miembro guarda la
invitación pero no envía nada; el código lo dice:
[`TODO: Send invitation email`](https://github.com/nextjs/saas-starter/blob/main/app/(login)/actions.ts#L454).
Tampoco tiene restablecer contraseña ni verificar el correo.

El acceso es solo con correo y contraseña: ni Google ni GitHub, ni passkeys, ni segundo factor.

El cobro es una suscripción por equipo. Checkout empieza con cantidad uno y 14 días de prueba, y la
cantidad solo cambia si alguien la edita en el Customer Portal
([stripe.ts](https://github.com/nextjs/saas-starter/blob/main/lib/payments/stripe.ts)). Añadir un
miembro no cambia la factura.

Y avanza despacio. Sus dos últimos commits, del 8 y el 11 de diciembre de 2025, fueron
actualizaciones de seguridad de Next.js; el segundo lo pasó a Next.js `15.6.0-canary.59` por la
corrección de CVE-2025-55182. El anterior a ellos fue en junio de 2025.

Nada de esto es un defecto para lo que la plantilla dice ser. Solo significa que lo primero que
necesita un equipo que paga sigue siendo trabajo tuyo.

## Las alternativas, lado a lado

| Función              | Next.js SaaS Starter   | Seed                          | Open SaaS                    | Makerkit                                 | Supastarter                      |
| -------------------- | ---------------------- | ----------------------------- | ---------------------------- | ---------------------------------------- | -------------------------------- |
| Precio               | Gratis                 | Gratis                        | Gratis                       | $299 o $599, pago único                  | De $349 a $1.499, pago único     |
| Licencia             | MIT                    | MIT                           | MIT                          | De pago; el kit Lite es MIT              | De pago                          |
| Stack                | Next.js, Drizzle       | Hono, Preact; Postgres        | Wasp (React, Node.js)        | Next.js 16 o TanStack Start, entre otros | Next.js, Nuxt o TanStack Start   |
| Equipos y roles      | Propietario y miembro  | De lector a propietario       | No                           | Sí, con invitaciones                     | Sí, con invitaciones             |
| Correo de invitación | No se envía            | Sí                            | Sin equipos                  | No comprobado                            | No comprobado                    |
| Cobros               | Stripe, uno por equipo | Stripe, por miembro           | Stripe, Polar, Lemon Squeezy | No comprobado                            | Stripe, Lemon Squeezy y tres más |
| Hosting              | Vercel                 | Docker Compose en tu servidor | Fly.io o Railway             | No comprobado                            | Vercel, serverless o Docker      |

Fuentes: [Next.js SaaS Starter](https://github.com/nextjs/saas-starter),
[Open SaaS](https://github.com/wasp-lang/open-saas),
[precios de Makerkit](https://makerkit.dev/pricing), [Supastarter](https://supastarter.dev/) y el
[README de Seed](https://github.com/spy4x/seed). Los precios de Makerkit son los rebajados; los de
lista son $349 y $649. «No comprobado» significa que no lo encontré en las páginas que leí, no que
falte.

## ¿Qué alternativa elijo?

**Quieres seguir en Next.js con más incluido.** Paga Makerkit o Supastarter. Las dos tienen
organizaciones con invitaciones y roles; Supastarter cobra por puesto y ofrece cinco proveedores de
pago. Makerkit Lite es gratis y MIT, pero sin equipos ni cobros.

**Lo quieres gratis y con los equipos hechos.** Eso es Seed. Cada cuenta trae un grupo, con roles
de lector a propietario; las invitaciones salen por correo; Stripe cobra por miembro y la cantidad
sigue al número de miembros, con plan gratuito, 14 días de prueba y periodo de gracia tras un pago
fallido. El acceso también está hecho: contraseña con código de confirmación, passkeys, Google,
GitHub, códigos por correo, cuentas de invitado y una app autenticadora como segundo factor
([acceso en Seed](/es/features/sign-in)). Súmale una app de administración con auditoría, tiempo
real, una app sin conexión y nueve idiomas. El precio: no es Next.js, sino Hono y Preact.

**Vendes a personas sueltas y te gusta que un framework haga la unión.** Mira Open SaaS; también
escribí sobre [sus alternativas](/es/blog/alternativas-a-open-saas).

## ¿Cuánto cuesta el hosting: Vercel o un servidor?

El README de la plantilla despliega en Vercel y acepta cualquier URL de Postgres. Seed corre en un
servidor que alquilas. Aquí están los dos, con Vercel Pro y Supabase Pro como una pareja gestionada
habitual; elige un servidor y mueve el control según tu equipo:

<HostingCost server="cx23" developers={1} />

Con un desarrollador, Seed en un Hetzner CX23 cuesta 12,48 € al mes y la pareja gestionada $45,
unos 40,12 € al cambio del BCE del 2 de noviembre de 2026. No es comparar lo mismo: lo gestionado
te ahorra parchear un servidor y alguien más hace las copias de la base. El cálculo completo, con
cada precio y su fuente, está en
[desplegar un SaaS en un servidor de Hetzner](/blog/deploy-saas-to-one-hetzner-server) (en inglés).

## ¿Cuándo sigue siendo mejor Next.js SaaS Starter?

- Quieres aprender App Router y Server Actions con un código que se lee entero.
- Vas a hacer el acceso y los cobros a tu manera y quieres borrar lo menos posible.
- Tu equipo sabe Next.js y React, y despliegas en Vercel.

Los riesgos de Seed, para la balanza: es joven y tiene un solo mantenedor. Su API y su worker
también corren en Node o Bun con una línea en el archivo env
([sobre el runtime](https://github.com/spy4x/seed/blob/main/docs/apps.md#runtime)), pero el sitio
web y las herramientas siguen necesitando Deno.

## ¿Cómo pruebo Seed antes de decidir?

Abre la [demo en vivo](https://app.seedsaas.com): un clic te mete en una cuenta de invitado con
datos de ejemplo. Invita a un compañero y abre la facturación, justo lo que la plantilla de Next.js
te deja a ti. Si encaja, clona [el repositorio](https://github.com/spy4x/seed). Para una vista más
amplia, [alternativas a ShipFast](/es/blog/alternativas-a-shipfast) compara siete plantillas en
una tabla.
