# Billing for operators

> Also on the website: [seedsaas.com/docs/billing-operator](https://seedsaas.com/docs/billing-operator).

This page covers billing from the support side: the admin panel's Billing pages, who may do what,
transfers of ownership, and the cases you fix in the Stripe dashboard.

**You need:** billing set up ([Set up billing](billing.md)), and an operator account in the admin
panel.

## The admin panel's Billing pages

**Billing** in the admin panel lists every group with a subscription. With billing off, it says so
and links to the setup guide. The list shows:

- Figures: monthly revenue at list price per currency, paying and past-due groups, trials, trials
  ending within 7 days, and subscriptions set to end.
- Status chips: paying (the default), trial, past due, ending, cancelled, all.
- A search, and 25 groups per page.

A group's page shows its plan, seats, dates and last payment, and offers five actions:

| Action               | What it does                                         | Who                  |
| -------------------- | ---------------------------------------------------- | -------------------- |
| Refund               | Refunds the group's last payment in full.            | Supervisor and above |
| Give time            | Moves the trial's end, from 7 days to 12 months.     | Any operator         |
| Cancel at period end | The plan ends when the paid period ends.             | Any operator         |
| Cancel now           | Ends the subscription at once.                       | Supervisor and above |
| Undo cancellation    | Takes back a cancellation that waits for period end. | Any operator         |

Every action takes an optional note of up to 200 characters, and writes it to the audit log. A
retried action acts once. An operator who owns or belongs to the group is refused: another operator
handles it.

Time at no charge counts from the later of now and the time already covered. Only a trialing,
active or past-due subscription can get it.

## Who may do what in the product

- Every member sees the group's plan on the Billing tab.
- Only the owner may open a checkout or the Stripe customer portal. Another member gets 403
  `ROLE_INSUFFICIENT`, and a person outside the group gets 404.
- A group whose subscription is not cancelled cannot open a second checkout: 409
  `ALREADY_SUBSCRIBED`. That holds even when the subscription shows as Free (paused or incomplete).
  The owner changes or cancels it in the portal. A subscription on a price not in the catalog is
  never stored, so it does not block a second checkout until the price is added and its event
  resent.
- A group with a live subscription cannot be deleted: 409 `GROUP_SUBSCRIBED`. The owner cancels in
  the portal first, and the settings page says so.

## Transfer of ownership

A Stripe customer holds the card, name, address and invoices of the owner who checked out. Stripe
cannot move a subscription to another customer. So a transfer never gives the new owner the old
owner's customer, and never charges the old owner's card again without their say:

1. **A subscription that still renews blocks the transfer:** 409 `SUBSCRIPTION_RENEWS`. The owner
   cancels it in the portal first, at the end of the paid period.
2. **The old customer is handed over for good.** The app opens no portal for it, for the new owner
   or the old one. No later event of that customer takes the group back.
3. **The group keeps its plan until the paid period ends.** Nothing is charged, and no seats change.
   Its mails, such as "plan ending", go to the old owner who pays for it.
4. **The new owner checks out with a customer of their own.** Their trial lasts until the old plan
   ends, rounded up to whole days, and always asks for a card. The two subscriptions never bill the
   same days. Once the old plan has ended, the new owner's checkout has no trial.

The settings page tells the owner this before they transfer.

## Fix it in the Stripe dashboard

The app cannot reach these cases. Fix each one in the Stripe dashboard:

- **Two subscriptions for one group.** Two checkouts opened before either is paid can both be paid.
  Refund and cancel the extra one.
- **A subscription for a deleted group.** The owner paid, then deleted the group before the webhook
  arrived. The purge keeps such a group and the worker logs it. Cancel the subscription, and the
  next purge removes the group.
- **A renewal just before a transfer.** The owner renewed in the portal, then transferred before
  Stripe's webhook arrived. The subscription renews on their card, and nobody can reach its portal.
  Cancel it.
- **A renewal after a transfer.** The old owner renewed outside the app. The group keeps the
  subscription, and the new owner's checkout answers 409 `ALREADY_SUBSCRIBED`. Cancel it.

## Known limits

- The handover trial carries over the old plan's remaining days whatever plan the new owner picks.
- Until the old subscription ends, the new owner cannot delete the group (409 `GROUP_SUBSCRIBED`).
  The refusal tells them to cancel in the portal, which they cannot open.
- After a transfer, the new owner's trial notice says the trial ends three days before the old
  plan would have.
- The old owner can no longer see past invoices through the app. Stripe's receipts reach them by
  mail.
- One worker drains the outbox, so a group's seat syncs run one after another. With two workers, an
  older count could reach Stripe last, and only a later webhook would correct it.

## Next

- [Trials, failed payments and cancelling](billing-lifecycle.md).
- [Set up billing](billing.md).
