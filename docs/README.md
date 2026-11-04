# Documentation

Pick the guide that fits. New here? Start with [Get started](get-started.md). The
[README](../README.md) has the pitch.

## Get started

- [Get started](get-started.md): run Seed on your machine in four commands.
- [Building a product on Seed](products.md): start a product, take Seed's later changes, give
  back to Seed.
- [Start a product: what belongs to Seed's own website](start-a-product.md): what a new product
  deletes, replaces or sets.
- [Run the local stack](local-stack.md): run Seed on your machine with demo data, and reset it.
- [Add your first feature](first-feature.md): a new kind of record, from the database to the screen.
- [Work with an AI agent](ai-agents.md): have an AI agent create a product from Seed, add features
  and check its work.

## Guides

- [Deploy to a server](deploy.md): from a fresh server to a healthy deployment with HTTPS.
- [Deploy an update](deploy-updates.md): every deploy after the first, and rolling back.
- [HTTPS certificates](certificates.md): how each host gets its certificate, and retrying one.
- [Give operators access](operator-access.md): the first administrator, roles, and opening
  Grafana.
- [Run several projects on one server](several-projects.md): products that share one server and
  one Traefik.
- [Publish a release](releases.md): a version tag publishes the images to Docker Hub.
- [Backups](backups.md): turn on the daily backup, and rehearse it.
- [Restore from a backup](restore.md): bring back the database, the files and the push keys.
- [Sign in with Google and GitHub](sign-in-providers.md): registering the providers and what a
  person gets.
- [Guest accounts](guests.md): "Try it now" without signing up, keeping the account, the limits
  and the clean-up.
- [Set up billing](billing.md): paid plans through Stripe, test mode first, then live.
- [Plans and limits](billing-plans.md): change a plan, add one, or add a limit a plan sells.
- [Billing for operators](billing-operator.md): the admin panel's Billing pages, transfers, and
  Stripe's dashboard.
- [The file store](files.md): Garage or another S3 store, its settings and the upload budget.
- [Add file uploads to a feature](file-uploads.md): upload and download files from a feature, and
  have photos made safe and small.
- [A person's data export](data-export.md): Download my data, what the ZIP holds and how it expires.
- [The catalog](catalog.md): a shop's items with photos, colours and sizes, edited in the admin
  panel; off unless a product turns it on.
- [Telegram bot](telegram.md): BotFather, the webhook, linking a chat, and adding a product's
  commands.
- [Offline in the SPA](offline.md): turn the offline layer or the WebSocket module off, or remove
  them.
- [Adding a feature](aggregates.md): every file of the notes aggregate, in order.
- [Make an aggregate work offline](aggregate-offline.md): read, and write, an aggregate with no
  network.
- [Link two aggregates](aggregate-relations.md): one aggregate naming another, with tags and notes
  as the example.
- [Delete, move and export an aggregate](aggregate-lifecycle.md): restore after delete, a move to
  another group, and the data export.
- [Connect a feature to the app](aggregate-extras.md): group settings, the overview, the inbox and
  the rest of the app.
- [Admin modules](admin-modules.md)
- [Run the load tests](load-tests.md): run the k6 scenarios and build a large test group.
- [Run the browser tests](browser-tests.md): the Playwright specs in e2e/, and which of them CI
  runs.
- [Postgres 18 upgrade](postgres-18-upgrade.md): once per server that ran Postgres 16.

## Concepts

- [The three apps](apps.md): the SPA, the admin app and the public website, and how to deploy each.
- [Architecture](architecture.md) and [the diagram](architecture.svg)
- [Ids](ids.md): every id is a UUID version 7.
- [Capacity](capacity.md): how many users one server carries.
- [Trials, failed payments and cancelling](billing-lifecycle.md): a group's plan from checkout to
  cancellation, and its mails.
- [How offline reads work](offline-data.md): what the SPA keeps on the device and how it reads
  offline.
- [How offline writes sync](offline-writes.md): how a change made offline reaches the server, or is
  refused.
- [Sign-out and the device's data](offline-sign-out.md): what the SPA deletes, and keeps, when a
  person signs out.
- [The app shell](offline-app-shell.md): how the service worker starts the app with no network.
- [Note attachments and profile pictures](attachments-and-pictures.md): files kept on a note, and a
  person's picture in place of their initials.
- [One large group](large-group.md): how one group behaves from a thousand notes to a million.

## Reference

- [Every task](development.md): every `deno task`, what it does and where it is explained.
- [Settings](settings.md): every variable of the env file.
- [Writing the docs](writing-docs.md): how a guide here is written and published.
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
