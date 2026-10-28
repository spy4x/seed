# Billing

Each group has one subscription, paid by its owner through Stripe. A group without a paid
subscription is on the Free plan. Stripe owns the money and the subscription; this app keeps only
what Stripe's webhooks report, and never decides a plan on its own.

The provider code comes from `jsr:@spy4x/billing` (`createStripeBilling`). In the SPA, billing lives
on the group page's **Plan and billing** tab (`/groups/:groupId/billing`, `GroupBillingPanel` in
`libs/ui/billing-screen.tsx`): every member reads the plan there, and only the owner gets the
checkout and portal buttons. The old plans page, `/groups/:groupId/pricing`, opens that tab.

## Plans

The catalog is `PLANS` in `libs/domain/billing/+lib.ts`:

| Plan id | Name | Price                    | Stripe price                     |
| ------- | ---- | ------------------------ | -------------------------------- |
| `free`  | Free | 0                        | none                             |
| `pro`   | Pro  | €9.00 per member a month | `STRIPE_PRICE_PRO` (environment) |

Pro starts with a 14-day trial (`trialDays` on the plan).

A group is on a paid plan while its subscription is trialing or active, and for a grace period
while it is past due (below). A canceled, incomplete or paused subscription, or one billing a price
that is not in the catalog, puts the group back on Free. To add a plan, add it to `PLANS`, add its
price variable to `readBillingSetup` (`libs/server/billing/setup.ts`), to
`infra/envs/.env.example` and to the `environment` of the api and worker services in
`infra/compose/compose.shared.yml`.

## Per-member pricing

Pro is billed per member (`perSeat` on the plan,
[spy4x/template#205](https://github.com/spy4x/template/issues/205)). The subscription's quantity is
the group's member count, the owner included: the same count that `maxMembers` caps. A pending
invitation reserves no seat; accepting it does.

- **Checkout** asks Stripe for one seat per member at that moment.
- **A change of members** (someone joins through an invitation, is removed, or leaves) is committed
  first. When the worker publishes that change, it also queues a seat sync job in the outbox. The
  job reads the member count and, when it differs from the quantity stored, asks the provider to
  set it (`BillingProvider.updateQuantity`). Stripe prorates by its default: the rest of the period
  is added to, or credited on, the next invoice; nothing is charged at once. The app computes no
  money.
- **With the provider down** the member is added all the same. The job fails and the outbox tries
  it again with backoff, with the same idempotency key, so Stripe applies it once. The stored
  quantity catches up when the provider answers.
- **The webhook** stores the quantity Stripe reports. When it differs from the member count (a
  change made in the dashboard, or a sync that has not run yet), it queues a seat sync in the same
  transaction.
- **The nightly cleanup** queues a seat sync for every group whose stored quantity differs from its
  count. That catches a sync the outbox gave up on after a long outage, and a count that moved
  without a group change, such as a member's account being deleted.
- **Subscriptions that existed before per-member pricing** start with an empty stored quantity
  (migration `2026_10_14_0001_subscription_quantity.sql`). The first nightly run queues a seat sync
  for each, so each live Pro subscription moves from one seat to one per member then. Stripe
  prorates the change on the next invoice, and the owner gets no notice of it.

**The owner confirms the price.** In a group billed per member, the invitation form shows what one
more member adds to the bill and a box to accept it (`SeatPriceConfirm`). A create without
`acceptSeatPrice: true` is refused with `SEAT_PRICE_NOT_ACCEPTED`, so the confirmation holds without
JavaScript too. Only the owner and admins, who may create invitations, are asked; anyone else learns
nothing about the bill from the answer. The Plan and billing tab shows the price times the members.

## Failed payments

When a renewal charge fails, Stripe marks the subscription `past_due` and retries the card on its
own schedule. The group keeps its plan for a grace period, `BILLING_GRACE_DAYS` days (default 7)
counted from the first past-due event, and gets the Free plan's entitlements after it. Nothing is
deleted: the subscription stays stored as past due, and everything over a Free cap stays as in
"Downgrade" below.

- The start is `subscriptions.past_due_since`, the `created` time of the first past-due event.
  Later past-due events keep it; Stripe's `unpaid` arrives as past due too
  (`@spy4x/billing` maps both to `PastDue`), so giving up on retries does not restart the clock.
- A past-due event that arrives after a newer event is stale and ignored, as every event is (the
  delivery rules under "Flow"). If Stripe delivers the first failure late, after a newer past-due
  event, the grace period starts at that newer event instead. This only lengthens the grace in the
  customer's favour, and only by as long as Stripe's delivery was delayed.
- Any other status clears it. A payment that makes the subscription active again brings the plan
  back at once; a later failure starts a new grace period.
- Only a subscription that has paid gets the grace period
  ([spy4x/template#247](https://github.com/spy4x/template/issues/247)). `subscriptions.ever_active`
  turns true at the subscription's first active event and stays true while the same subscription is
  held; a new subscription starts without it. A trial whose first charge fails goes from trialing
  straight to past due, never active, so the group is on Free from that failure, which is the
  trial's end. The grace exists to keep a paying customer whose card expired, not to lengthen a free
  trial.
- An active event that Stripe delivers after a newer past-due one is stale and changes nothing
  else, but it still sets `ever_active`: it proves that the subscription paid.
- `effectivePlanId(subscription, now, graceDays)` in `libs/domain/billing/+lib.ts` decides. The
  command bus's plan check and the billing read both take the current time and the grace period
  from `planClockOf` (`apps/api/features/billing/config.ts`), so the cut-off is exact to the
  request, with no job.

**How it meets Stripe's retries.** Stripe's retry window ("Manage failed payments", up to about two
months) and this grace period are separate clocks. While Stripe retries, the subscription stays
`past_due` even with "cancel the subscription" chosen, so the grace period is what bounds free use:
a group gets at most `BILLING_GRACE_DAYS` of its plan after the first failure, however long Stripe
retries. A payment that succeeds during the retries restores the plan. When the retries end,
"cancel the subscription" (step 6 below) ends the subscription for good, so the group needs a new
checkout; the other two settings leave it past due or unpaid, which this app treats the same way,
Free after the grace period. Keep step 6: a cancelled subscription also lets the owner check out
again, which a past-due one blocks (409 `ALREADY_SUBSCRIBED`).

## Trials

A trial is given once per person, not once per group
([#205](https://github.com/spy4x/seed/issues/205)): otherwise anyone could keep the paid plan for
ever by creating new groups. A checkout of a plan with `trialDays` asks Stripe for a trial of that
length only when both hold:

- The group has no Stripe customer yet, because it never paid or trialed.
- The owner's trial is unused, or already went to this group. The checkout claims it for the group
  in one conditional `UPDATE` of the owner's row (`users.trial_group_id`, with `trial_used_at`), so
  two checkouts of two groups opened at the same time never both get it. A second checkout of the
  same group, after the owner closed Stripe's page, still gets it.

Only the owner checks out, so joining someone else's group never uses a person's trial. The
handover trial after a transfer of ownership ("Transfer of ownership" below) carries the old owner's
paid time and does not use the new owner's trial. The checkout decides on the server; the client
cannot ask for a trial. `GET /api/billing/trial` answers the signed-in person's own `{ enabled,
used, groupId, days }`: the page that creates a group says from it whether a trial comes with the
new group, and the Plan and billing tab still offers the trial to the group that holds it, whose
checkout claims it again. The admin panel shows when a person's trial was used, on the person's Overview tab.

`BILLING_TRIAL_REQUIRES_CARD` decides whether the trial's checkout asks for a card. It is `true`
by default: a trial with a card converts on its own, and a person who cannot pay does not get one.
With `false`, Stripe starts the trial without a card (`trialWithoutPaymentMethod` in
`@spy4x/billing`); if none is added by the trial's end, Stripe cancels the subscription and the
group goes back to Free.

The webhook stores the trial's end (`subscriptions.trial_end`). The group has the plan while the
subscription is trialing and the stored end is still ahead, and gets Free from that instant on,
even before Stripe's next event arrives. When the trial converts, Stripe reports the subscription
active and the plan stays. When the charge at the trial's end fails, the subscription goes past due
without ever having been active, so it gets no grace period ("Failed payments" above): the group
stays on Free while Stripe retries, and a payment that goes through brings the plan back.

## Cancelling and undoing

The owner cancels in the Stripe customer portal, which cancels at the end of the paid period
(Stripe's `cancel_at_period_end`). The group keeps its plan until `current_period_end`, and gets
Free from that instant on. Until then the owner can renew the plan in the same portal; the next
webhook clears the flag and the plan simply continues. The portal must allow both (step 5 below).

`effectivePlanId` and `accessEndsAt` in `libs/domain/billing/+lib.ts` hold both bounds, the
trial's and the cancellation's, with the same request clock as the grace period.

## Notices

The owner is told three things, by e-mail and by a banner on the group's settings page in both
apps. Other members see neither.

| Notice         | When                                                   | Banner shown                        |
| -------------- | ------------------------------------------------------ | ----------------------------------- |
| Trial ending   | 3 days before the trial ends (`TRIAL_NOTICE_DAYS`)     | from then until the trial ends      |
| Payment failed | on the first past-due event                            | while past due, with the grace end  |
| Plan ending    | when a cancellation at period end arrives              | until the period ends or it is undone |

`billingNoticeOf` (`libs/domain/billing/+lib.ts`) decides the banner from the stored subscription
and the request clock. A failed payment wins over the other two.

A failed trial has no grace, so its banner and mail say the group is already on Free and that
updating the card brings the plan back; a failed renewal's say the plan is kept for the grace
period.

The webhook queues each mail as a job in the outbox, in the transaction that stores the event
(`libs/server/billing/billing-notices.ts`): a failed payment and a cancellation at once, a trial's
notice at its end minus three days. A job is keyed by its group, its kind and its time, so a
repeated or reordered event queues nothing twice. When a job runs, the worker reads the
subscription again and sends only a notice that still holds: a payment that went through, an
undone cancellation or a converted trial sends nothing, and a trial whose end moved is told only by
the job for the new end (`libs/server/jobs/billing-notice-mail.ts`). The mail goes to the owner's
first proven address; an owner with none gets no mail, and the worker logs a warning without the
address. A failed send is retried. With mail off, nothing is sent.

## Who may do what

- Every member sees the group's plan in the group's settings.
- Only the owner may open a checkout or the Stripe customer portal. Anyone else gets 403
  (`ROLE_INSUFFICIENT`), and a person outside the group gets 404.
- A group with a subscription that is not cancelled cannot open a second checkout (409
  `ALREADY_SUBSCRIBED`), even when that subscription shows as Free (paused, incomplete, or on a
  price not in the catalog). The owner changes or cancels it in the portal.
- The owner sees the portal button whenever the group has a live subscription or a Stripe customer
  (past invoices, the card on file), except a customer handed over by a transfer of ownership
  ("Transfer of ownership" below).
- A group with a live subscription cannot be deleted (409 `GROUP_SUBSCRIBED`); the owner cancels the
  subscription in the portal first. The settings page disables the delete button and says why.

## Transfer of ownership

A Stripe customer belongs to one group (`billing_customers`, keyed by the group) and carries the
card, name, address and invoices of the owner who checked out. Stripe cannot move a subscription to
another customer. So a transfer of ownership
([spy4x/template#250](https://github.com/spy4x/template/issues/250)) never gives the new owner the
old owner's customer, and never lets the old owner's card be charged again without their say:

1. **A subscription that still renews refuses the transfer** (409 `SUBSCRIPTION_RENEWS`). The owner
   cancels it in the portal first, at the end of the paid period. A subscription cancelled at its
   period's end, or one that has ended, lets the transfer through. The check runs in the transfer's
   transaction, under the group lock (`handOverBilling` in `libs/server/billing/handover.ts`).
2. **The transfer records the old customer as handed over, for good**
   (`billing_handed_over_customers`, with the owner who paid with it). From then on the app opens no
   portal for it: the new owner gets no portal buttons on the Plan and billing tab and
   the portal answers 409 `NO_SUBSCRIPTION`, and the old owner, now an admin, may not open it
   either. Nobody sees the old owner's billing details through the app. No subscription of that
   customer ever takes the group back, even one that pays later (a past-due invoice paid on retry,
   an edit in the Stripe dashboard): its events update only the subscription the group still holds.
   Each subscription stores its own customer, and that customer decides.
3. **The group keeps its plan until the paid period ends**, as any cancelled plan does. Nothing is
   charged in that time: the subscription does not renew, and the worker changes no seats on it
   (the seat sync and the nightly drift check skip a subscription whose own customer is handed
   over). Its mails, such as "plan ending" or "payment failed", go to the old owner who pays for it,
   never to the new owner.
4. **The new owner checks out with a customer of their own.** The Plan and billing tab shows them
   the free plan's checkout button, with no notice about the old subscription. Their checkout carries no
   customer, so Stripe makes a new one, and starts with a trial that lasts until the old plan ends
   (`handoverTrialDays`, whole days rounded up), with a card always asked. The new owner is first
   charged when the old owner's paid time is over, and the two subscriptions never bill the same
   days. The new subscription takes over the group as soon as it trials ("Flow" below), its customer
   replaces the old one, and the old subscription's later events, its end included, change
   nothing.
   Once the old plan has ended, the new owner's checkout has no trial: the group had its trial,
   and the new owner's own trial is not spent on it.

The settings page tells the owner this before they transfer.

## Entitlements

What a plan allows lives in the plan itself: `entitlements` on each entry of `PLANS`, with feature
flags and numeric limits. No handler names a plan; a command says what it needs, and the plan
answers.

| Key            | Kind    | Free    | Pro     | Enforced                                                     |
| -------------- | ------- | ------- | ------- | ------------------------------------------------------------ |
| `memberRoles`  | feature | no      | yes     | Promoting a member (`GroupMemberRoleCommand`)                |
| `maxNotes`     | limit   | 10      | no cap  | Creating a note (`NoteCreateCommand`), or moving notes into the group (`NoteMoveCommand`; the gate reserves room for one, the repository counts all)                 |
| `maxMembers`   | limit   | 3       | 50      | Inviting (`GroupInvitationCreateCommand`) and accepting      |
| `maxAttachments` | limit | 100     | no cap  | Signing and confirming a note attachment (`attachment.sign`, `attachment.confirm`): the files of every note of the group |
| `storageBytes` | limit   | 200 MiB | 10 GiB  | The same two: the bytes of those files                        |

Each plan also has `attachments` (`maxFileBytes` 2 MiB, `maxPerNote` 10 on both plans), the rules
for one file and one note ([files.md](files.md), "Note attachments"). They are not caps a plan
sells, so they hold with billing off too.

A limit of `null` means no cap.

**One check, on the command bus.** `apps/api/cqrs/entitlement-gate.ts` runs after the idempotency
middleware, so a retry still gets its stored answer; `apps/api/cqrs/command-middleware.ts` holds
that order, and its test fails if it changes. `ENTITLEMENT_NEEDS`
(`apps/api/cqrs/entitlement-needs.ts`) lists each command that needs something from its group's
plan. The gate reads the group's plan and refuses such a command before its handler runs. Queries
pass untouched, and so does every command that is not listed.

The gate judges a listed command only when the handler would carry it out on a plan that allows
it. Anything the handler refuses on every plan goes on to the handler, which gives the same answer
on Free as on Pro:

- a stranger gets 404, and a viewer who tries to write gets 403;
- an admin who tries to demote the owner gets 409 `LAST_OWNER`;
- a role change for someone who has left the group gets 404 `MEMBER_NOT_FOUND`.

**Only a promotion is a paid feature.** `memberRoles` gates a role change that raises the member's
role. A group on any plan can give a member a lower role or remove them, so a group back on Free
can still demote an admin it made on Pro.

**The refusal.** The API answers **402 Payment Required**, so a client can tell a plan refusal from
a role refusal (403):

```json
{
  "error": {
    "code": "forbidden",
    "message": "The group has reached its plan's limit",
    "reason": "PLAN_LIMIT_REACHED",
    "details": {
      "code": "PLAN_LIMIT_REACHED",
      "entitlement": "maxNotes",
      "limit": 10,
      "canUpgrade": true
    }
  }
}
```

`reason` is `PLAN_FEATURE_MISSING` or `PLAN_LIMIT_REACHED`. `canUpgrade` is true only for the
owner, the one person who can change the plan. The socket answers the same: `forbidden`, with the
same fields in `details` ([api-errors.md](api-errors.md)). `readPlanRefusal` reads either
one back. The SPA then shows `PlanRefusalNotice`: the owner gets a link to the group's Plan and
billing tab, and anyone else is told to ask the owner.

**Counted in the write's transaction.** The gate counts before the handler runs, outside any
transaction, so two requests can both pass it for the last free slot. The gate therefore passes
the cap to the handler (`allowance` on the command). The note repository counts again after its
insert, in the same transaction, under the group row lock that every note write already takes. The
second request waits for the first to commit, counts it, and is refused.
`tests/integration/plan-limits.integration.test.ts` races two creates for the last slot to prove
it. A handler that gets no `allowance` throws, so a bus without the gate fails closed.

**Downgrade.** Nothing is deleted when a group drops to a smaller plan. Everything over a cap stays
readable, editable and deletable; only a write that adds to the count is refused, until the group
is back under the cap or upgrades. A feature the new plan lacks is refused from then on: members
promoted on Pro keep their roles and can still be demoted or removed, but nobody new is promoted.

**Billing off.** With `BILLING_PROVIDER=off` nobody can pay to lift a cap, so every group gets
every feature with no cap (`UNLIMITED`). The settings page still shows the group as Free.

**Adding a key.** Add it to `FeatureKey` or `LimitKey`; TypeScript then asks for it in every plan
and in `UNLIMITED`. Add its wording to `REFUSAL_TEXT` in `libs/ui/plan-refusal.tsx`. List the
command in `ENTITLEMENT_NEEDS` with `needsFeature` or `needsRoom`. A limit also needs a usage count
in `apps/api/cqrs/entitlements.ts` (the gate refuses to start without one), and the write must count
again inside its transaction, as the note repository does.

## Configuration

`BILLING_PROVIDER` picks the provider:

| Value      | What runs                                                                       |
| ---------- | ------------------------------------------------------------------------------- |
| unset      | `off` in production, `fake` with `ENV=dev`                                      |
| `off`      | No billing: every group shows as Free with no caps; checkout and the webhook answer 404        |
| `stripe`   | Stripe. Needs `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `STRIPE_PRICE_PRO` |
| `fake`     | The development provider, below. Refused in production                         |

With `stripe` and any of the three keys missing, the API refuses to start and names the missing
ones. The worker reads the same setup (`readBillingSetup` in `libs/server/billing/setup.ts`) to
change a per-member subscription's quantity, but verifies no webhook: it needs `STRIPE_SECRET_KEY`
and `STRIPE_PRICE_PRO`, refuses to start without either, and never receives
`STRIPE_WEBHOOK_SECRET`. Any other value of `BILLING_PROVIDER` also stops the start.

`BILLING_GRACE_DAYS` sets the grace period for failed payments: a whole number of days from 0 to
90, 7 when unset or empty. Any other value stops the start.

`BILLING_TRIAL_REQUIRES_CARD` is `true` or `false`: whether starting a trial asks for a card
("Trials" above). Unset or empty means `true`; any other value stops the start.

The worker reads the same variables: it runs the seat sync ("Per-member pricing" above) with the
same provider. Compose passes them to both services, and `tests/compose-api-env.test.ts` checks
that neither misses one.

## Flow

1. The owner opens the group's **Plan and billing** tab and presses **Start 14-day free trial** (or
   **Upgrade to Pro** once their trial is used). The API asks Stripe for a checkout session with the
   group's id as its reference and sends the browser there.
2. Stripe takes the card (a trial charges nothing yet) and returns the browser to the tab, at
   `/groups/:groupId/billing?checkout=done`. The tab says Stripe is confirming the plan. Once the
   webhook below has changed the plan, a toast says "Your 14-day Pro trial has started", or
   "You're on Pro" after a paid start. The portal and a cancelled checkout return to the tab too.
3. Stripe posts `customer.subscription.created` to `POST /api/webhooks/billing`. The API checks the
   signature first; then, in one transaction, it stores the event id, writes the group's
   subscription and its customer, and records `group.plan.changed` in the outbox when the plan or
   the status changed (a renewal that only moves the period's end records nothing). The worker
   announces the change, and every open page of the group reads the plan again.
4. Later changes (renewal, a failed payment, a cancellation from the portal) arrive the same way.

Delivery rules the webhook keeps:

- A repeated event id changes nothing, so Stripe's retries are safe.
- An event older than the one stored never rolls the plan back. Events are ordered by Stripe's
  `created` second, then by kind (created, updated, deleted). Within one second a later kind wins
  over an earlier one whatever order they arrive in; two events of the same kind in the same second
  keep the one that arrives last. See "Known limits".
- Another subscription replaces the one held when it pays (trialing or active), whatever the held
  one's status, or when the held one is cancelled. One that does not pay never replaces a live
  one: the end or a late failed payment of an old subscription leaves the newer one, and the
  group's plan, as they are ([spy4x/template#242](https://github.com/spy4x/template/issues/242)).
- A bad or missing signature gets 400; a body that cannot be read after a valid signature, and
  events this app does not handle, get 200 so Stripe stops sending them; a failure while storing
  gets 500 so Stripe retries.

## Test mode and the Stripe CLI

Use Stripe's test mode for everything but production: test keys start with `sk_test_`, and test
cards such as `4242 4242 4242 4242` pay without money.

1. In the Stripe dashboard (test mode), create a product "Pro" with a monthly price of €9.00, and
   copy its price id into `STRIPE_PRICE_PRO`.
2. Copy the test secret key into `STRIPE_SECRET_KEY`.
3. Forward webhooks to the local API with the [Stripe CLI](https://docs.stripe.com/stripe-cli):

   ```bash
   stripe login
   stripe listen --forward-to http://app.localhost/api/webhooks/billing \
     --events customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed
   ```

   `stripe listen` prints a `whsec_...` signing secret: put it in `STRIPE_WEBHOOK_SECRET`.
4. Set `BILLING_PROVIDER=stripe` and restart the API.
5. Configure the customer portal once in the dashboard (Settings, Billing, Customer portal), or
   Stripe refuses to open it. Allow customers to cancel subscriptions "at the end of the billing
   period", not immediately, so the group keeps what it paid for, and allow them to renew a
   cancelled subscription, which is how an owner undoes a cancellation.
6. Set failed payments to cancel the subscription (Settings, Billing, Subscriptions and emails,
   "Manage failed payments for subscriptions": when all retries fail, cancel the subscription).
   The grace period ("Failed payments" above) already drops a past-due group to Free after
   `BILLING_GRACE_DAYS`, whichever option is chosen; cancelling ends the subscription for good and
   lets the owner check out again, where a subscription left unpaid or overdue blocks a new
   checkout.

In production, add the webhook endpoint `https://<domain>/api/webhooks/billing` in the dashboard
with the same five events, use its signing secret, and set failed payments as in step 6. Keys live
in the environment only; the tracked `.env.example` holds empty placeholders.

## The development provider

With `ENV=dev` and no `BILLING_PROVIDER`, the API runs the development provider
(`createFakeBilling` in `libs/server/billing/setup.ts`). It calls no network:

- A checkout sends the browser straight back to the success URL, as if paid. Nothing changes until
  a webhook arrives.
- The portal sends the browser back to the group's Plan and billing tab.
- Webhooks are verified exactly as Stripe's are, with the public secret
  `whsec_template_development_only` and the price `price_fake_pro` for Pro. Anyone can sign a
  webhook with it, so a server running with `ENV=dev` and no `BILLING_PROVIDER` accepts webhooks
  from anyone who can reach it. Never expose such a server to the internet.

The e2e test drives an upgrade this way: it posts a recorded `customer.subscription.created`, signed
with that secret (`e2e/fixtures/billing.ts`), to the webhook. Production refuses the development
provider, so its public secret cannot sign a real event.

## Known limits

- `@spy4x/billing` cannot read a subscription back from Stripe yet
  ([spy4x/ts-libs#380](https://github.com/spy4x/ts-libs/issues/380)), so two events of the same
  kind in the same second that arrive out of order leave the older one stored. Stripe usually sends
  them in order; the next event, or a change in the portal, corrects it. Once the library can read
  the subscription back, the webhook will store what Stripe says now instead.
- Two checkout sessions opened before either is paid can both be paid, which starts two
  subscriptions for one group. The 409 above only covers a subscription the webhook has already
  stored. Refund and cancel the extra one in the Stripe dashboard.
- A webhook can store a subscription for a group that was already deleted, if the owner paid and
  deleted the group before the webhook arrived. The purge keeps such a group, and the worker logs
  how many it kept. The group is past its restore window, so the owner cannot reach the portal:
  cancel the subscription in the Stripe dashboard, and the next purge removes the group.
- Payment events are stored (so repeats are skipped) but change nothing yet.
- The end of a grace period, a trial or a cancelled period records no `group.plan.changed` event,
  since no webhook arrives at that instant. Every check reads the plan with the current time, so
  the cut-off holds; an open page shows the old plan until it reads the billing again (a reload, or
  the next change of the group).
- The failed-payment notice is on the Plan and billing tab only, not on every page of the group.
- The trial is claimed when the owner opens Stripe's checkout, not when the trial starts. An owner
  who opens the checkout of one group, closes it, and then checks out another group gets no trial
  there; the first group keeps it, also when it is deleted later.
- A person who deletes their account and signs up again gets a new trial: the trial is kept on the
  account.
- An invitation created before its group moved to per-member billing carries no price
  confirmation; accepting it still adds a seat. An admin confirms the price as the owner does.
- One worker drains the outbox today (compose names its container, so it runs once). Seat syncs of
  a group therefore run one after another. With two workers, two syncs could run at once and the
  older count could reach Stripe last: the stored quantity would then match the members while
  Stripe bills another count, and only a later webhook from Stripe would correct it.
- A transfer reads the subscription as the webhooks last reported it. If the owner renews a
  cancelled subscription in the portal and transfers the group before Stripe's webhook for the
  renewal arrives, the transfer goes through and the subscription renews on their card. Nobody can
  then reach its portal through the app: cancel it in the Stripe dashboard.
- If the old owner renews the cancelled subscription in Stripe after the transfer, outside the app,
  the group keeps it and the new owner sees the checkout button, but their checkout answers 409
  `ALREADY_SUBSCRIBED`. Nobody can reach that subscription's portal through the app: cancel it in
  the Stripe dashboard.
- The handover trial carries over the old plan's remaining days whatever plan the new owner picks,
  so days left of a cheaper plan become free days of a dearer one.
- After a transfer the new owner cannot delete the group until the old subscription has ended (409
  `GROUP_SUBSCRIBED`), and that refusal still tells them to cancel in the portal, which they cannot
  open.
- The new owner's first subscription after a transfer is a trial in Stripe's terms, so the trial
  notice ("Notices" above) tells them the trial ends three days before the old plan would have.
- The old owner, now an admin, can no longer see past invoices through the app; Stripe's receipts
  reach them by mail.
