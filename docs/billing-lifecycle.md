# Trials, failed payments and cancelling

> Also on the website: [seedsaas.com/docs/billing-lifecycle](https://seedsaas.com/docs/billing-lifecycle).

This page explains what happens to a group's plan from checkout to cancellation, and which mails the
owner gets on the way.

**You need:** billing set up ([Set up billing](billing.md)).

## Checkout and webhooks

1. The owner opens the group's **Billing** tab and presses **Start 14-day free trial**, or
   **Upgrade to Pro** once their trial is used.
2. The API opens a Stripe checkout with the group's id as its reference.
3. Stripe takes the card and returns the browser to `/groups/:groupId/billing?checkout=done`. The
   tab says Stripe is confirming the plan.
4. Stripe posts `customer.subscription.created` to `POST /api/webhooks/billing`.
5. The API checks the signature. In one transaction it stores the event id, the subscription and
   its customer, and records `group.plan.changed` in the outbox when the plan or status changed.
6. The worker announces the change. Every open page of the group reads the plan again, and the
   owner sees "Your 14-day Pro trial has started" or "You're on Pro".

Later changes, such as a renewal, a failed payment or a cancellation, arrive the same way.

The webhook keeps these rules:

- A repeated event id changes nothing, so Stripe's retries are safe.
- An older event never rolls the plan back. Events are ordered by Stripe's `created` second, then by
  kind: created, updated, deleted.
- A new subscription replaces the held one when it pays (trialing or active), or when the held one
  is cancelled. One that does not pay never replaces a live one.
- A bad signature gets 400. An event the app does not handle gets 200, so Stripe stops sending it.
  A failure while storing gets 500, so Stripe retries.

`invoice.paid` and `invoice.payment_failed` are stored, so repeats are skipped, but change nothing
yet.

## Trials

A person gets one trial, not one per group. Otherwise anyone could keep the paid plan for ever by
creating new groups. A checkout of a plan with `trialDays` asks Stripe for a trial only when both
hold:

- The group has no Stripe customer yet: it never paid or trialed.
- The owner's trial is unused, or already went to this group.

The checkout claims the trial in one conditional update of the owner's row (`users.trial_group_id`).
Two checkouts of two groups opened at once never both get it. A second checkout of the same group
still gets it.

The server decides; the client cannot ask for a trial. Only the owner checks out, so joining
someone else's group never uses a person's trial.

`GET /api/billing/trial` answers the signed-in person's `{ enabled, used, groupId, days }`. The page
that creates a group uses it to say whether a trial comes with the new group. The admin panel shows
when a person used their trial, on the person's Overview tab.

`BILLING_TRIAL_REQUIRES_CARD=false` starts the trial without a card. If none is added by the trial's
end, Stripe cancels the subscription and the group goes back to Free. The default, `true`, asks for
a card, so the trial converts on its own.

The group has the plan while the subscription is trialing and the trial's end is still ahead. It
gets Free from that instant, even before Stripe's next event. When the trial converts, the plan
stays.

## Failed payments

When a renewal charge fails, Stripe marks the subscription `past_due` and retries the card on its
own schedule. The group keeps its plan for `BILLING_GRACE_DAYS` days (default 7), counted from the
first past-due event. After that it gets the Free plan's limits. Nothing is deleted.

- Later past-due events keep the start. Stripe's `unpaid` counts as past due too, so giving up on
  retries does not restart the clock.
- A payment that makes the subscription active again brings the plan back at once.
- **Only a subscription that has paid gets the grace period.** A trial whose first charge fails goes
  straight to past due, so the group is on Free from the trial's end. The grace keeps a paying
  customer whose card expired; it does not lengthen a free trial.

Stripe's retry window, up to about two months, is a separate clock. The grace period bounds free
use however long Stripe retries. When the retries end, the setting from step 9 of
[the setup](billing.md#set-up-stripe-in-test-mode) cancels the subscription, so the owner can check
out again.

## Cancelling and undoing

1. The owner cancels in the Stripe customer portal. The portal cancels at the end of the paid
   period.
2. The group keeps its plan until the period ends, then gets Free.
3. Until then, the owner can renew in the same portal. The plan simply continues.

The portal must allow both ([setup step 8](billing.md#set-up-stripe-in-test-mode)).

## Notices

The owner gets three mails. Other members get none.

| Notice         | Sent                                            |
| -------------- | ----------------------------------------------- |
| Trial ending   | 3 days before the trial ends                    |
| Payment failed | On the first past-due event                     |
| Plan ending    | When a cancellation at the period's end arrives |

While a payment has failed, the Billing tab also shows the owner a warning with the grace period's
end. A failed trial has no grace, so its warning and mail say the group is already on Free and that
updating the card brings the plan back.

The webhook queues each mail in the outbox, in the transaction that stores the event. A repeated or
reordered event queues nothing twice. When a mail's job runs, the worker sends it only if it still
holds: a payment that went through, an undone cancellation or a converted trial sends nothing.

The mail goes to the owner's first proven address. An owner with none gets no mail. With mail off,
nothing is sent.

## Known limits

- The end of a grace period, a trial or a cancelled period sends no event. Every check reads the
  plan with the current time, so the cut-off holds. An open page shows the old plan until it reads
  the billing again.
- Two events of the same kind in the same second that arrive out of order leave the older one
  stored. The next event, or a change in the portal, corrects it. The fix waits on
  [spy4x/ts-libs#380](https://github.com/spy4x/ts-libs/issues/380).
- The trial is claimed when the owner opens Stripe's checkout. An owner who opens one group's
  checkout, closes it, and checks out another group gets no trial there. The first group keeps it,
  even when it is deleted later.
- A person who deletes their account and signs up again gets a new trial.

## Next

- [Billing for operators](billing-operator.md): refunds, time at no charge, transfers.
- [Plans and limits](billing-plans.md).
