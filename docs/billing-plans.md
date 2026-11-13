# Plans and limits

> Also on the website: [seedsaas.com/docs/billing-plans](https://seedsaas.com/docs/billing-plans).

This page shows how to change a plan, add one, or add a new limit that a plan sells.

**You need:** billing set up ([Set up billing](billing.md)).

## The plans

The catalog is `PLANS` in `libs/domain/billing/+lib.ts`:

| Plan id | Name | Price                    | Yearly price | Trial   | Stripe price       |
| ------- | ---- | ------------------------ | ------------ | ------- | ------------------ |
| `free`  | Free | 0                        | none         | none    | none               |
| `pro`   | Pro  | €9.00 per member a month | none         | 14 days | `STRIPE_PRICE_PRO` |

A plan with a `yearlyAmount` is sold a year at a time too
([yearly price](billing.md#sell-a-yearly-price)).

A group is on a paid plan while its subscription is trialing or active. It also keeps the plan for
a grace period after a failed payment ([failed payments](billing-lifecycle.md#failed-payments)).
A canceled, incomplete or paused subscription puts the group back on Free. An event for a price
not in the catalog changes nothing: the group keeps the plan it had, even when the event cancels
the subscription ([unknown prices](billing.md#sell-a-yearly-price)). So before you replace a plan's
Stripe price, keep the old price in the settings until no subscription bills it.

## Add a plan

1. Add the plan to `PLANS`: its `amount` in cents, its `yearlyAmount` (or `null` for monthly only),
   `trialDays`, `perSeat` and `entitlements`.
2. Map it to its Stripe price in `planRefs` and `readBillingSetup`
   (`libs/server/billing/setup.ts`), with a new price variable.
3. Add the variable to `infra/envs/.env.example`.
4. Pass it to the `api` and `worker` services in `infra/compose/compose.shared.yml`.
5. Create the price in Stripe and set the variable.

## Replace the catalog in a product

A product sells its own plans: edit `PLANS` and its price variables, as above, and Seed's tests keep
passing. They do not read `PLANS`:

- Unit and integration tests run on a fixed catalog of their own, `TEST_PLANS` in
  `libs/domain/billing/test-plans.ts`, a copy of Seed's Free and Pro. A function that reads the
  catalog takes it as its last parameter, `PLANS` by default, and the tests pass `TEST_PLANS`.
  Production code never imports that file; `tests/test-catalog-boundary.test.ts` fails if it does.
  The worker's billing jobs take the catalog as `JobDeps.plans`.
- A test spells out only the caps it is about: `testLimits` in the same file fills in every other
  limit key, and `testUsage` gives the entitlement gate a count for every key that fails the test if
  read. A limit key the product adds needs no edit in Seed's tests, and the test plans give it no
  cap.
- The website's tests and the demo seed's test read `PLANS` itself: they check what the site and the
  demo show.
- The browser tests read what the running stack answers: the trial from `GET /api/billing/trial`,
  the note cap from the API's refusal and the seat price from the group's billing. When the free
  plan allows nothing (the development route `GET /api/test/free-plan` says so), the fixtures put
  every new group on the paid plan through the development provider's webhook, so the specs run on
  any catalog: the sign-up fixture (`e2e/fixtures/sign-up.ts`) pays for the group sign-up made,
  `createGroup` (`e2e/fixtures/groups.ts`) for a group made on its page, and a spec that creates a
  group through the API calls `payForGroup` after it. A spec about the free plan itself opts out
  with `{ keepFree: true }`, as `e2e/plan-limits.e2e.ts` and `e2e/billing.e2e.ts` do. In that mode:
  - sign-up waits for the worker to finish the starter data first (`POST /api/test/starter-data`),
    so a new account has no welcome note, every run the same;
  - a paid group bills per seat, so a spec that invites through the API sends
    `acceptSeatPrice: true`;
  - an imported group starts on the free plan, so the import is refused.

Keep the ids `free` and `pro` (`FREE_PLAN_ID` and `PRO_PLAN_ID`): the code names the free plan and
the development provider maps its prices to `pro`. To rename the paid plan, change its `name`.

## Per-member pricing

Pro is billed per member (`perSeat` on the plan). The subscription's quantity is the group's member
count, the owner included. That is the same count `maxMembers` caps. A pending invitation reserves
no seat; accepting it does.

- **Checkout** asks Stripe for one seat per member at that moment.
- **A member joins, leaves or is removed.** The change is saved first. The worker then queues a seat
  sync in the outbox, which asks Stripe for the new quantity when it differs from the stored one.
- **Stripe prorates.** By its default, the rest of the period is added to, or credited on, the next
  invoice. Nothing is charged at once, and the app computes no money.
- **Stripe is down.** The member is added all the same. The outbox retries the sync with backoff
  and the same idempotency key, so Stripe applies it once.
- **The webhook** stores the quantity Stripe reports. When it differs from the member count, it
  queues a seat sync in the same transaction.
- **The nightly cleanup** queues a seat sync for every group whose stored quantity differs from its
  count. That catches a sync the outbox gave up on, and a count that moved without a group change,
  such as a deleted account.

**The owner confirms the price.** In a group billed per member, the invitation form shows what one
more member adds to the bill, with a box to accept it. A create without `acceptSeatPrice: true` is
refused with `SEAT_PRICE_NOT_ACCEPTED`, so the rule holds without JavaScript too. Only the owner and
admins create invitations, so nobody else learns about the bill.

An invitation created before its group moved to per-member billing carries no price confirmation.
Accepting it still adds a seat.

## What each plan allows

A plan's `entitlements` hold feature flags and numeric limits. No handler names a plan: a command
says what it needs, and the plan answers.

| Key              | Free    | Pro    | Checked when                                                 |
| ---------------- | ------- | ------ | ------------------------------------------------------------ |
| `memberRoles`    | no      | yes    | A member is promoted (`GroupMemberRoleCommand`)              |
| `maxNotes`       | 10      | no cap | A note is created, or notes move into the group              |
| `maxMembers`     | 3       | 50     | An invitation is created or accepted                         |
| `maxAttachments` | 100     | no cap | A note attachment is signed or confirmed: files of all notes |
| `storageBytes`   | 200 MiB | 10 GiB | The same: the bytes of those files                           |

A limit of `null` means no cap. Each plan also has `attachments` rules for one file and one note
(`maxFileBytes` 2 MiB, `maxPerNote` 10 on both plans). They are not sold by a plan, so they hold
with billing off too ([Limits](attachments-and-pictures.md#limits)).

**Only a promotion is a paid feature.** Any plan may give a member a lower role or remove them. A
group back on Free can still demote an admin it made on Pro.

**Downgrade deletes nothing.** Everything over a cap stays readable, editable and deletable. Only a
write that adds to the count is refused, until the group is under the cap or upgrades.

**Billing off.** With `BILLING_PROVIDER=off` nobody can pay to lift a cap, so every group gets every
feature with no cap (`UNLIMITED`). The settings page still shows the group as Free.

## The refusal

A plan refusal is **402 Payment Required**, so a client can tell it from a role refusal (403):

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

`reason` is `PLAN_FEATURE_MISSING` or `PLAN_LIMIT_REACHED`. `canUpgrade` is true only for the owner,
who alone can change the plan. The socket answers the same ([api-errors.md](api-errors.md)). In the
SPA, `PlanRefusalNotice` gives the owner a link to the Billing tab and tells anyone else to ask the
owner.

## Add a limit or a feature

1. Add the key to `FeatureKey` or `LimitKey` in `libs/domain/billing/+lib.ts`. TypeScript then asks
   for it in every plan and in `UNLIMITED`.
2. Give it a refusal message: its wording in `REFUSAL_KEYS` (`libs/ui/plan-refusal.tsx`), and
   those keys in the app's catalogs in `i18n/app/`. TypeScript asks for the entry; without it the
   app cannot say why the plan refused.
3. List each command that needs it in `ENTITLEMENT_NEEDS` (`apps/api/cqrs/entitlement-needs.ts`),
   with `needsFeature` or `needsRoom`.
4. For a limit, add a usage count to `usage` in `apps/api/cqrs/entitlements.ts`. The gate refuses
   to start without one.
5. For a limit, count again inside the write's transaction, as the note repository does.
6. For a limit on an aggregate that "move all of a group's data" moves, its `MovableAggregate`
   counts what it moves against `context.allowances.<key>`, every cap of the target's plan, which
   the gate fills in (`docs/aggregate-lifecycle.md`).

Step 5 closes a race: the gate counts before the handler runs, so two requests can both pass it for
the last free slot. The gate passes the cap to the handler (`allowance` on the command). The
repository counts again after its insert, under the group's row lock, and refuses the second write.

`tests/integration/plan-limits.integration.test.ts` races two creates to prove it. A handler that
gets no `allowance` throws, so a bus without the gate fails closed.

The gate runs on the command bus, after the idempotency middleware, so a retry still gets its stored
answer. It judges a command only when the handler would allow it on some plan. A stranger still
gets 404, and a viewer who tries to write gets 403, on every plan.

## Next

- [Trials, failed payments and cancelling](billing-lifecycle.md).
- [Billing for operators](billing-operator.md).
- [Set up billing](billing.md).
