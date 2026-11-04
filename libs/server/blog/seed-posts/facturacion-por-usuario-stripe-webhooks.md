---
slug: facturacion-por-usuario-stripe-webhooks
language: es
translationOf: per-seat-billing-stripe-webhooks-retries
title: "Facturación por usuario con Stripe y webhooks que aguantan los reintentos"
seoTitle: "Facturación por usuario con Stripe: webhooks seguros ante reintentos"
description: "Cómo Seed cobra a un equipo por miembro con Stripe: el número de asientos sigue a la lista de miembros mediante una tarea que se reintenta, y cada webhook se aplica una sola vez y nunca hacia atrás."
tldr:
  - "En Seed, la cantidad de la suscripción en Stripe es el número de miembros del grupo, propietario incluido. Stripe prorratea el cambio; la app no calcula dinero."
  - "Primero entra el miembro y luego cambia la factura: una tarea del worker pide a Stripe la nueva cantidad y reintenta con la misma clave de idempotencia mientras Stripe no responde."
  - "El id de cada evento se guarda en la misma transacción que lo aplica: una repetición no cambia nada y un fallo deshace ambas cosas para que Stripe lo reintente."
  - "Un evento antiguo nunca devuelve un plan atrás, y una tarea nocturna corrige cualquier número de asientos que se haya desviado."
topic: A fondo
intro: "Cobrar por usuario parece un solo número: miembros por precio. Lo difícil es que ese número siga siendo correcto mientras la gente entra, Stripe se cae y los webhooks llegan dos veces o desordenados. Así lo hace Seed, con el código real."
coverAlt: "Una fila de butacas de teatro violetas, cada una con una planta en maceta, mientras un brote nuevo baja colgado de un hilo hacia una butaca más."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-05T09:00:00Z
newsletter: true
---

¿Cómo cobras un SaaS por usuario con Stripe sin que la factura se aleje del equipo real? En Seed,
la cantidad de la suscripción es simplemente el número de miembros del grupo, y la app no confía en
una sola llamada ni en un solo webhook para mantenerla. El cambio de miembros se guarda primero;
una tarea que se reintenta pide a Stripe la nueva cantidad; cada webhook se registra por su id de
evento en la misma transacción que lo aplica; y una tarea nocturna arregla lo que se haya escapado.

Este artículo es para quien añade facturación por equipos a un SaaS, y para quien ya sufrió un
handler de webhooks que funcionaba bien hasta que Stripe lo reintentó. Todo está en el
[código de Seed](https://github.com/spy4x/seed), con licencia MIT, y cito las líneas reales.

## ¿Qué significa facturar por usuario en Seed?

La facturación pertenece a un grupo, el equipo de Seed. Cada grupo tiene una suscripción, que paga
su propietario. El catálogo tiene dos planes ([`PLANS`](https://github.com/spy4x/seed/blob/main/libs/domain/billing/+lib.ts)):

| Plan | Precio                    | Miembros | Prueba  |
| ---- | ------------------------- | -------- | ------- |
| Free | 0                         | hasta 3  | no      |
| Pro  | 9,00 € por miembro al mes | hasta 50 | 14 días |

«Por miembro» significa que la cantidad de la suscripción en Stripe es el número de miembros del
grupo, incluido el propietario. Es el mismo número que usa el límite de 50, así que un asiento se
define una vez y no de dos formas que discrepan. Una invitación pendiente no reserva asiento;
aceptarla, sí.

Esto es lo que paga un equipo con los precios de la demo. Mueve el control:

<CostCalculator members={5} />

Cinco personas en Pro pagan 45 € al mes. El propietario ve el precio de un asiento más antes de
invitar a nadie: el formulario de invitación muestra lo que añade el nuevo miembro y pide aceptarlo.
La API rechaza una invitación sin esa aceptación (`SEAT_PRICE_NOT_ACCEPTED`), así que la regla se
cumple aunque el formulario se envíe sin JavaScript.

## ¿Por qué entra el miembro antes de que Stripe se entere?

Porque un Stripe lento nunca debe impedir que alguien se una a un equipo. El código obvio llama a
Stripe dentro de la petición «aceptar invitación»: si Stripe tarda demasiado, o la persona no puede
entrar, o entra y la factura queda mal para siempre. Las dos cosas son malas, y la segunda no se ve.

Seed guarda primero el cambio de miembros, en su propia transacción. Al confirmarla escribe una fila
en el outbox, y el worker convierte cada cambio (entró, lo quitaron, se fue) en una tarea de
sincronización de asientos. La tarea lee la cantidad cuando se ejecuta y solo llama a Stripe si
difiere de la guardada ([`seat-sync.ts`](https://github.com/spy4x/seed/blob/main/libs/server/billing/seat-sync.ts)):

```ts
const members = await new PostgresInvitationRepository(sql).countMembers(groupId)
if (members < 1 || row.quantity === members) return
const result = await provider.updateQuantity({
  subscriptionId: row.providerSubscriptionId,
  quantity: members,
  // A retry of this row asks for the same count with the same key; a later count gets its own.
  idempotencyKey: `seats:${event.id}:${members}`,
})
if (!result.ok) {
  throw new Error(`seat sync of group ${groupId} failed: ${result.error.code} ...`)
}
```

Tres detalles sostienen todo:

1. **La cantidad se lee cuando la tarea se ejecuta**, no cuando se encoló. Cinco personas que entran
   en un minuto necesitan una llamada correcta, no cinco compitiendo.
2. **La clave de idempotencia nombra la tarea y la cantidad.** Si Stripe aplicó el cambio y la
   respuesta se perdió, el reintento envía la misma clave y Stripe devuelve el primer resultado en
   lugar de aplicarlo dos veces.
3. **Un fallo lanza un error.** El sistema de tareas reintenta tras 1 s, 2 s, 4 s y así, con hasta
   15 minutos entre intentos, 20 veces, unas dos horas y media ([jobs.md](https://github.com/spy4x/seed/blob/main/docs/jobs.md)).

El cambio de cantidad pide a Stripe `proration_behavior=create_prorations`, su
[valor por defecto](https://docs.stripe.com/billing/subscriptions/prorations): el resto del periodo
se suma a la próxima factura o se descuenta de ella. La app nunca calcula un euro prorrateado por su
cuenta. Las cuentas de dinero que no escribo son cuentas que no puedo equivocar.

## ¿Y si la sincronización nunca llega?

Hay dos caminos más, porque dos horas y media de reintentos no son «para siempre»:

- **El webhook también lo comprueba.** Cuando Stripe informa de una suscripción cuya cantidad no
  coincide con el número de miembros, la misma transacción que guarda el evento encola una
  sincronización. Así se corrige un checkout abierto antes de que alguien entrara.
- **Una tarea nocturna revisa todos los grupos de pago.** A las 03:00, la limpieza busca cada
  suscripción por miembro cuya cantidad guardada no coincide con el grupo y encola una
  sincronización. Eso cubre una caída larga de Stripe y un cambio sin evento del grupo, como un
  miembro que borra su cuenta.

Así que los asientos quedan bien tras el siguiente cambio, el siguiente webhook o la siguiente
noche, lo que llegue antes. Lo prefiero a un diseño que solo acierta si todas las llamadas salen
bien.

## ¿Cómo haces que un webhook de Stripe sea seguro ante reintentos?

Stripe [reintenta una entrega fallida](https://docs.stripe.com/webhooks#automatic-retries) hasta
tres días en modo live, y avisa de que un endpoint puede recibir el mismo evento más de una vez. Un
handler que suma un asiento o envía un correo en cada entrega lo hará dos veces, antes o después.

El webhook de Seed hace tres cosas en un orden fijo. Primero, la firma: el adaptador
[`@spy4x/billing`](https://jsr.io/@spy4x/billing) comprueba la cabecera `Stripe-Signature` contra el
cuerpo sin procesar, con una ventana de cinco minutos, antes de leer un byte de JSON. Una firma
inválida recibe `400`. Después, todo ocurre en una transacción de Postgres que empieza registrando
el id del evento ([`postgres-billing-repository.ts`](https://github.com/spy4x/seed/blob/main/libs/server/billing/postgres-billing-repository.ts)):

```ts
return await this.sql.begin(async (transaction) => {
  const stored = await transaction`
    INSERT INTO billing_events (id, event_type) VALUES (${event.id}, ${event.type})
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `
  if (stored.length === 0) return "duplicate"
  // ... apply the subscription, queue mails and seat syncs, record the plan change
})
```

`billing_events.id` es la clave primaria, así que la segunda entrega no inserta nada y sale sin tocar
la suscripción. Como el id se guarda _dentro_ de la transacción, el caso contrario también es
seguro: si algo falla después, el id se deshace con todo lo demás, la ruta responde `500` y el
reintento de Stripe tiene un segundo intento limpio. Guardar el id primero y aplicar después, en dos
pasos, perdería el evento la primera vez que un despliegue reinicie la API entre ambos.

Los correos al propietario (pago fallido, fin de la prueba, fin del plan) se encolan en el outbox en
esa misma transacción, así que un evento repetido nunca encola un segundo correo. Un evento que Seed
no gestiona recibe `200`, y Stripe deja de enviarlo.

## ¿Y los eventos que llegan desordenados?

Stripe [no garantiza el orden](https://docs.stripe.com/webhooks#event-ordering) de los eventos. Un
`customer.subscription.updated` tardío que dice «trialing» no debe deshacer el `active` anterior.
Seed escribe la suscripción con un upsert que solo avanza:

```sql
ON CONFLICT (group_id) DO UPDATE SET ...
WHERE (subscriptions.provider_event_at, subscriptions.provider_event_rank)
    <= (EXCLUDED.provider_event_at, EXCLUDED.provider_event_rank)
```

Primero cuenta la hora del evento y su tipo desempata: creado, luego actualizado, luego borrado. Un
evento más antiguo no coincide con ninguna fila y no cambia nada. Una segunda regla en el mismo
`WHERE` impide que una suscripción nueva que no paga (por ejemplo, con un cobro fallido tardío)
sustituya a una que sí paga.

Te cuento el límite sin rodeos. La documentación de Stripe dice que no se use `created` para ordenar
eventos, porque va en segundos enteros. Seed lo usa solo como freno contra los retrocesos, nunca
para detectar duplicados, que es para lo que sirve el id del evento. Dos eventos del mismo tipo en
el mismo segundo que llegan al revés todavía dejan guardado el antiguo, hasta que el siguiente
evento o un cambio en el portal lo corrige. Ese caso está escrito en
[la documentación de facturación](/es/docs/billing-lifecycle#known-limits), y el arreglo espera a
[spy4x/ts-libs#380](https://github.com/spy4x/ts-libs/issues/380). Prefiero contártelo a que lo
descubras tú.

## ¿Lo demuestran los tests?

Corren contra un Postgres real. Los 26 pasos de la suite del webhook
(`tests/integration/billing.integration.test.ts`) incluyen «una segunda entrega del mismo evento no
cambia nada» y «un evento más antiguo que el guardado nunca devuelve el plan atrás». Los asientos
tienen su propia suite (`tests/integration/seat-billing.integration.test.ts`), con pasos como «un
miembro eliminado y uno que se va lo bajan en uno cada uno» y «la tarea nocturna encola un cambio de
asientos por cada grupo desviado».

## ¿Qué no hace Seed?

Para que lo sepas antes de construir sobre él:

- **Un plan de pago, mensual, por miembro.** Sin cobro por uso ni medido, sin niveles. Añadir un plan
  son cinco pasos en [Plans and limits](/es/docs/billing-plans).
- **Solo Stripe.** El código habla con una interfaz de proveedor, pero Stripe es el único adaptador
  que existe. También puedes apagar la facturación, y entonces cada grupo tiene todas las funciones.
- **`invoice.paid` e `invoice.payment_failed` se guardan, pero aún no cambian nada.** El plan sigue
  el estado de la propia suscripción.
- **El dinero se queda en Stripe.** La app guarda lo que dicen los webhooks y nunca decide un plan
  por su cuenta.

## Pruébalo

Abre la [demo](https://app.seedsaas.com), crea un grupo y mira su pestaña Facturación; invita a
alguien y verás el precio del asiento antes de enviar. La versión corta está en la
[página de facturación](/es/features/billing), [Set up billing](/es/docs/billing) te lleva de cero a
Stripe real, primero en modo de prueba, y los grupos tienen [su propia página](/es/features/groups).
Si tu handler de webhooks guarda el id del evento en un paso y lo aplica en otro, esa es la primera
línea que cambiaría hoy.
