---
slug: per-seat-billing-stripe-webhooks-retries
language: en
title: "Per-seat billing with Stripe, and webhooks that survive retries"
seoTitle: "Per-seat Stripe billing with webhooks that survive retries"
description: "How Seed bills a team per member with Stripe: the seat count follows the member list through a retried job, and every webhook is applied once, never out of order."
tldr:
  - "In Seed, a group's Stripe quantity is its member count, owner included. Stripe prorates the change; the app computes no money."
  - "The member joins first and the bill follows: a worker job asks Stripe for the new count and retries with the same idempotency key while Stripe is down."
  - "Each webhook's event id is stored in the transaction that applies it, so a repeat changes nothing and a failure rolls both back for Stripe to retry."
  - "An older event never rolls a plan back, and a nightly job corrects any seat count that drifted."
topic: Deep dive
intro: "Per-seat billing looks like one number: members times price. The hard part is keeping that number right while people join, Stripe is down, and webhooks arrive twice or out of order. This is how Seed does it, with the real code."
relatedFeature: billing
cover: covers/per-seat-billing-stripe-webhooks-retries.webp
coverAlt: "A row of violet theatre seats seen from the side, each holding a potted plant, with one empty seat folding down as a new seedling arrives."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-05T09:00:00Z
newsletter: true
---

How do you bill a SaaS per seat with Stripe without the bill drifting away from the team? In Seed,
the subscription's quantity is simply the group's member count, and the app never trusts a single
call or a single webhook to keep it there. A member change is saved first; a retried job then asks
Stripe for the new count; every webhook is stored by its event id in the same transaction that
applies it; and a nightly job fixes whatever slipped through.

This post is for developers adding team billing to a SaaS, and for anyone who has been burned by a
webhook handler that worked fine until Stripe retried it. Everything below is in
[Seed's code](https://github.com/spy4x/seed), MIT-licensed, and I quote the real lines.

## What does per-seat billing mean in Seed?

Billing belongs to a group, Seed's team. Each group has one subscription, paid by its owner. The
catalog has two plans ([`PLANS`](https://github.com/spy4x/seed/blob/main/libs/domain/billing/+lib.ts)):

| Plan | Price                    | Members  | Trial   |
| ---- | ------------------------ | -------- | ------- |
| Free | 0                        | up to 3  | none    |
| Pro  | €9.00 per member a month | up to 50 | 14 days |

"Per member" means the subscription's quantity in Stripe is the group's member count, the owner
included. It is the same count the 50-member cap uses, so there is one definition of a seat, not
two that disagree. A pending invitation reserves no seat; accepting it does.

Here is what that costs a team. The demo uses these prices, so move the slider:

<CostCalculator members={5} />

Five people on Pro pay €45 a month. The owner sees the price of one more seat before inviting
anyone: the invitation form shows what the new member adds and asks to accept it. The API refuses
an invitation without that acceptance (`SEAT_PRICE_NOT_ACCEPTED`), so the rule holds even when the
form is posted without JavaScript.

## Why does the member join before Stripe hears about it?

Because Stripe being slow must never stop a person joining a team. The obvious code calls Stripe
inside the "accept invitation" request: if Stripe times out, either the person cannot join, or they
join and the bill is wrong for ever. Both are bad, and the second one is silent.

Seed saves the member change first, in its own transaction. Committing it writes a row to the
outbox, and the worker turns every membership change (joined, removed, left) into a seat sync job.
The job reads the count when it runs and asks Stripe only when it differs from what is stored
([`seat-sync.ts`](https://github.com/spy4x/seed/blob/main/libs/server/billing/seat-sync.ts)):

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

Three details carry the weight:

1. **The count is read when the job runs**, not when it was queued. Five people joining in a minute
   need one correct call, not five racing ones.
2. **The idempotency key names the job and the count.** If Stripe applied the change and the answer
   got lost, the retry sends the same key and Stripe answers with the first result instead of
   applying it twice.
3. **A failure throws.** The job system retries after 1 s, 2 s, 4 s and so on, up to 15 minutes
   apart, for 20 attempts, about two and a half hours ([jobs.md](https://github.com/spy4x/seed/blob/main/docs/jobs.md)).

The quantity change asks Stripe for `proration_behavior=create_prorations`, Stripe's
[default](https://docs.stripe.com/billing/subscriptions/prorations): the rest of the period is
added to, or credited on, the next invoice. The app never works out a prorated euro itself. Money
maths I don't write is money maths I can't get wrong.

## What if the sync never lands?

Two more paths catch it, because two and a half hours of retries is not "for ever":

- **The webhook checks too.** When Stripe reports a subscription whose quantity differs from the
  member count, the same transaction that stores the event queues a seat sync. A checkout opened
  before someone joined corrects itself this way.
- **A nightly job compares every paying group.** At 03:00 the cleanup lists each per-member
  subscription whose stored quantity differs from the group's count and queues a sync for it. That
  covers a long Stripe outage and a count that moved without a group change, such as a member
  deleting their account.

So the seat count is right after the next change, the next webhook or the next night, whichever
comes first. I prefer that to a design that is right only when every call succeeds.

## How do you make a Stripe webhook safe to retry?

Stripe [retries a failed delivery](https://docs.stripe.com/webhooks#automatic-retries) for up to
three days in live mode, and says an endpoint may receive the same event more than once. A handler
that adds a seat or sends a mail on every delivery will, sooner or later, do it twice.

Seed's webhook does three things in a fixed order. First, the signature: the
[`@spy4x/billing`](https://jsr.io/@spy4x/billing) adapter checks the `Stripe-Signature` header
against the raw body, within five minutes, before it parses a byte of JSON. A bad signature gets
`400`. Then everything else happens in one Postgres transaction that starts by recording the event
id ([`postgres-billing-repository.ts`](https://github.com/spy4x/seed/blob/main/libs/server/billing/postgres-billing-repository.ts)):

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

`billing_events.id` is the primary key, so the second delivery inserts nothing and returns before
touching the subscription. Because the id is stored *inside* the transaction, the opposite case is
safe too: if anything after it fails, the id rolls back with the rest, the route answers `500`, and
Stripe's retry gets a clean second attempt. Storing the id first and applying later, in two steps,
would lose the event the first time a deploy restarts the API between them.

The owner's mails (payment failed, trial ending, plan ending) are queued in the outbox inside the
same transaction, so a repeated event never queues a second mail. An event Seed doesn't handle gets
`200`, so Stripe stops sending it.

## What about events that arrive out of order?

Stripe [does not guarantee the order](https://docs.stripe.com/webhooks#event-ordering) of events.
A late `customer.subscription.updated` saying "trialing" must not undo the `active` that came
before it. Seed writes the subscription with an upsert that only moves forward:

```sql
ON CONFLICT (group_id) DO UPDATE SET ...
WHERE (subscriptions.provider_event_at, subscriptions.provider_event_rank)
    <= (EXCLUDED.provider_event_at, EXCLUDED.provider_event_rank)
```

The event's time comes first and its kind breaks a tie: created, then updated, then deleted. An
older event matches no row and changes nothing. A second rule in the same `WHERE` stops a new
subscription that isn't paying (a late failed charge, say) from taking over from one that is.

I'll be straight about the limit. Stripe's docs say not to use `created` to order events, because
it is in whole seconds. Seed uses it only as a guard against rolling back, never to spot
duplicates, which is what the event id is for. Two events of the same kind in the same second that
arrive reversed still leave the older one stored, until the next event or a change in the portal
corrects it. That case is written down in
[the billing docs](/docs/billing-lifecycle#known-limits), and the fix waits on
[spy4x/ts-libs#380](https://github.com/spy4x/ts-libs/issues/380). I'd rather tell you than have you
find it.

## Do the tests prove any of this?

They run against a real Postgres. The 26 steps of the webhook's suite
(`tests/integration/billing.integration.test.ts`) include "a second delivery of the same event
changes nothing" and "an event older than the stored one never rolls the plan back". The seats
have a suite of their own (`tests/integration/seat-billing.integration.test.ts`), with steps such as
"a removed member and one who leaves each lower it by one" and "the nightly job queues a seat
change for each drifted group".

## What does Seed not do?

So you know before you build on it:

- **One paid plan, monthly, per member.** No usage-based or metered billing, no tiers. Adding a plan
  is five steps in [Plans and limits](/docs/billing-plans).
- **Stripe only.** The code talks to a provider interface, but Stripe is the one adapter that
  exists. Billing can also be off, and then every group gets every feature.
- **`invoice.paid` and `invoice.payment_failed` are stored but change nothing yet.** The plan follows
  the subscription's own status.
- **Money stays in Stripe.** The app keeps what the webhooks report and never decides a plan on its
  own.

## Try it

Open the [live demo](https://app.seedsaas.com), create a group and look at its Billing tab; invite
someone and you'll see the seat price before you send it. The [billing feature page](/features/billing)
has the short version, [Set up billing](/docs/billing) takes you from no billing to live Stripe in
test mode first, and groups themselves are on the [groups page](/features/groups). If your own
webhook handler stores the event id in one step and applies it in another, that's the first line
I'd change today.
