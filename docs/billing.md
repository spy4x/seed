# Set up billing

> Also on the website: [seedsaas.com/docs/billing](https://seedsaas.com/docs/billing).

This page takes your product from no billing to paid plans through Stripe, first in test mode,
then live.

Each group has one subscription, paid by the group's owner. A group without a paid subscription is
on the Free plan. Stripe owns the money and the subscription. The app keeps only what Stripe's
webhooks report and never decides a plan on its own.

**You need:**

- A Stripe account.
- The [Stripe CLI](https://docs.stripe.com/stripe-cli), to receive webhooks on your machine.
- Seed running locally ([development.md](development.md)).

The billing guides:

- This page: settings, test mode, going live, the development provider.
- [Plans and limits](billing-plans.md): the plans, per-member pricing, and what each plan allows.
- [Trials, failed payments and cancelling](billing-lifecycle.md): what happens to a subscription
  over time, and the mails the owner gets.
- [Billing for operators](billing-operator.md): the admin panel's Billing pages, transfers of
  ownership, and what to fix in the Stripe dashboard.

## Settings

Set these in `infra/envs/.env` (development) or `infra/envs/.env.prod` (the server). Compose passes
them to the API and the worker.

| Variable                      | What it does                                                   | Default                      |
| ----------------------------- | -------------------------------------------------------------- | ---------------------------- |
| `BILLING_PROVIDER`            | `stripe`, `off` or `fake` (development only).                  | `off`; `fake` with `ENV=dev` |
| `STRIPE_SECRET_KEY`           | Stripe's secret key. `sk_test_…` in test mode.                 | none                         |
| `STRIPE_WEBHOOK_SECRET`       | The signing secret of the webhook endpoint, `whsec_…`.         | none                         |
| `STRIPE_PRICE_PRO`            | The id of the Pro plan's price in Stripe, `price_…`.           | none                         |
| `STRIPE_PRICE_PRO_YEARLY`     | Pro's yearly price id; only when Pro has a `yearlyAmount`.     | none                         |
| `BILLING_GRACE_DAYS`          | Days a group keeps its plan after a failed payment. 0 to 90.   | `7`                          |
| `BILLING_TRIAL_REQUIRES_CARD` | `true` or `false`: whether a trial's checkout asks for a card. | `true`                       |

What each provider does:

| `BILLING_PROVIDER` | What runs                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------- |
| `off`              | No billing. Every group shows as Free, with no caps. Checkout and the webhook answer 404. |
| `stripe`           | Stripe, with the three `STRIPE_*` keys.                                                   |
| `fake`             | The development provider ([below](#the-development-provider)). Refused in production.     |

The API refuses to start on a bad value, and names what is wrong:

- With `stripe`, the API needs all three Stripe keys.
- The worker needs `STRIPE_SECRET_KEY` and `STRIPE_PRICE_PRO`, to change seat counts. It verifies no
  webhook, so it never receives `STRIPE_WEBHOOK_SECRET`.
- `BILLING_GRACE_DAYS` must be a whole number from 0 to 90, and `BILLING_TRIAL_REQUIRES_CARD` must
  be `true` or `false`. Unset or empty means the default.

`tests/compose-api-env.test.ts` checks that Compose passes every billing variable to both services,
the webhook secret to the API only.

## Set up Stripe in test mode

Test mode moves no money. Test keys start with `sk_test_`, and test cards such as
`4242 4242 4242 4242` always pay.

1. In the Stripe dashboard, switch to test mode.
2. Create a product "Pro" with a monthly price of €9.00. Copy its price id into `STRIPE_PRICE_PRO`.
3. Copy the test secret key into `STRIPE_SECRET_KEY`.
4. Forward webhooks to the local API:

   ```sh
   stripe login
   stripe listen --forward-to http://app.localhost/api/webhooks/billing \
     --events customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed
   ```

5. Copy the `whsec_…` secret that `stripe listen` prints into `STRIPE_WEBHOOK_SECRET`.
6. Set `BILLING_PROVIDER=stripe`.
7. Start the stack again, so the API and the worker read the new values:

   ```sh
   deno task dev
   ```

8. Set up the customer portal once (Settings, Billing, Customer portal), or Stripe refuses to open
   it. Allow customers to cancel "at the end of the billing period", not immediately. Allow them to
   renew a cancelled subscription: that is how an owner undoes a cancellation.
9. Set failed payments to cancel the subscription: Settings, Billing, Subscriptions and emails,
   "Manage failed payments for subscriptions", then "cancel the subscription" when all retries
   fail.

Step 9 matters. A cancelled subscription lets the owner check out again; one left unpaid blocks a
new checkout with 409 `ALREADY_SUBSCRIBED`. The group drops to Free after the grace period either
way ([failed payments](billing-lifecycle.md#failed-payments)).

To test, open a group's **Billing** tab as its owner and press **Start 14-day free trial**.

## Sell a yearly price

A plan sells a year too once its entry in `PLANS` has a `yearlyAmount`, in the currency's smallest
unit: `4000` is $40.00. Seed's own Pro has none, so it is sold monthly only. With a yearly price,
the Billing tab offers a Monthly/Yearly choice, `/pricing` shows both prices and the saving, and
the admin panel names each subscription's period.

1. Set `yearlyAmount` on the plan in `PLANS`.
2. In Stripe, add a yearly price to the same product. Copy its id into `STRIPE_PRICE_PRO_YEARLY`.
   With `stripe`, the API and the worker refuse to start when Pro has a yearly price and the
   variable is empty, or when the variable is set and Pro has none.
3. In the customer portal's settings, list both prices of the product, so an owner can switch
   period there. Let a switch happen at once, with proration: Stripe then charges or credits the
   difference, and the Billing tab's hint ("Stripe shows what you pay today before you confirm")
   stays true.
4. Turn on Stripe's reminder email about upcoming renewals, under Settings, Billing, Subscriptions
   and emails. A year is long enough for an owner to forget the charge.
5. Decide whether the yearly price includes tax before you sell it: a Stripe price's tax behaviour
   cannot change once the price has been used.

The period an owner picks only chooses which price the checkout opens. The plan and its period are
read from the price Stripe reports in the webhook, so a subscription is billed and stored for what
Stripe charges. A checkout for a period the plan does not sell is refused with 400
`PERIOD_NOT_OFFERED`.

A webhook for a price no plan maps to, such as a price added in Stripe but not to the settings,
changes no group's subscription. The API logs `billing event bills a price no plan maps to` with the
event and price ids, and keeps no record of the event. Add the price to the settings, then resend
the event from Stripe's dashboard: it applies like any other. The development provider
always knows a yearly Pro price (`price_fake_pro_yearly`, or `STRIPE_PRICE_PRO_YEARLY`), so a signed
event for it is read as yearly there.

## Go live

1. In the Stripe dashboard, in live mode, create the same product and price, and set up the
   portal and failed payments as in steps 8 and 9 above.
2. Add the webhook endpoint `https://<DOMAIN>/api/webhooks/billing` with the same five events.
3. In `infra/envs/.env.prod`, set `BILLING_PROVIDER=stripe`, the live secret key, the endpoint's
   signing secret and the live price id.
4. Deploy:

   ```sh
   deno task deploy
   ```

Keys live in the environment only. The tracked `infra/envs/.env.example` holds empty placeholders.

## The development provider

With `ENV=dev` and no `BILLING_PROVIDER`, the API runs a provider that calls no network:

- A checkout sends the browser straight back, as if paid. The plan changes only when a webhook
  arrives.
- The portal sends the browser back to the group's Billing tab.
- Webhooks are verified exactly as Stripe's are, with the public secret
  `whsec_template_development_only`. The Pro price is `price_fake_pro`, unless `STRIPE_PRICE_PRO`
  is set.

**Never expose such a server to the internet.** Anyone can sign a webhook with that public secret.
Production refuses the development provider, so the secret cannot sign a real event.

The e2e test drives an upgrade this way. It posts a recorded `customer.subscription.created`,
signed with that secret, to the webhook (`e2e/fixtures/billing.ts`).

## Next

- [Plans and limits](billing-plans.md): change the price or add a plan.
- [Trials, failed payments and cancelling](billing-lifecycle.md).
- [Billing for operators](billing-operator.md).
