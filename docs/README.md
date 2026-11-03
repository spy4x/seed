# Documentation

Pick the guide that fits. New here? Start with [Get started](get-started.md). The
[README](../README.md) has the pitch.

## Get started

- [Get started](get-started.md): run Seed on your machine in four commands.
- [Building a product on Seed](products.md): start a product, take Seed's later changes, give
  back to Seed.
- [Start a product: what belongs to Seed's own website](start-a-product.md): what a new product
  deletes, replaces or sets.

## Guides

- [Deploy and operate](deploy.md): certificates, the deploy, consoles, several projects on one
  server, releases.
- [Backups](backups.md): set up, restore, rehearse.
- [Sign in with Google and GitHub](sign-in-providers.md): registering the providers and what a
  person gets.
- [Guest accounts](guests.md): "Try it now" without signing up, keeping the account, the limits
  and the clean-up.
- [Billing](billing.md)
- [The file store](files.md): Garage or another S3 store, signed uploads and downloads.
- [A person's data export](data-export.md): Download my data, what the ZIP holds and how it expires.
- [The catalog](catalog.md): a shop's items with photos, colours and sizes, edited in the admin
  panel; off unless a product turns it on.
- [Telegram bot](telegram.md): BotFather, the webhook, linking a chat, and adding a product's
  commands.
- [Offline](offline.md): the SPA's local data and write queue, and how to remove it.
- [Adding a feature](aggregates.md): every file of the notes aggregate, in order.
- [Admin modules](admin-modules.md)
- [Capacity](capacity.md): load tests and how many users one server carries.
- [Postgres 18 upgrade](postgres-18-upgrade.md): once per server that ran Postgres 16.

## Concepts

- [The three apps](apps.md): the SPA, the admin app and the public website, and how to deploy each.
- [Architecture](architecture.md) and [the diagram](architecture.svg)
- [Ids](ids.md): every id is a UUID version 7.

## Reference

- [Development](development.md): the local stack, every task, the browser tests and what CI runs.
- [API errors](api-errors.md): the one error body every API answer that is not a success has.
- [Security headers](security-headers.md)
- [Woodpecker CI setup](woodpecker-ci-setup.md)
- [Handoff](handoff.md): the map of the repository, decisions made, traps.
- [Contributing](../CONTRIBUTING.md)

## Design

- [Stack](stack.md)
- [Principles](principles.md)
- [Runtime policy](runtime-policy.md)
- [Decisions](decisions/): [ADR 001](decisions/001-deno-platform-template.md),
  [ADR 002](decisions/002-realtime-transport-and-sync.md),
  [ADR 003](decisions/003-swappable-transport-and-local-data.md)
- [UI and design](design/)
- [Group sync product requirements](prd/group-sync-platform.md)
- [Financy extraction inventory](financy-extraction-inventory.md)
- [Screenshots](screenshots/): `record.ts` re-records the README's pictures, and `admin-video.ts`
  (`deno task video:admin`) the website's admin panel video.
