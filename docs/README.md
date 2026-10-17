# Documentation

Pick the guide that fits. The [README](../README.md) has the pitch and the quick start.

## Use

- [Quick start](../README.md#quick-start): run the stack on your machine.
- [The three apps](apps.md): the SPA, the admin app and the public website, and how to deploy each.
- [Deploy and operate](deploy.md): certificates, the deploy, consoles, several projects on one
  server, releases.
- [Sign in with Google and GitHub](sign-in-providers.md): registering the providers and what a
  person gets.
- [Backups](backups.md): set up, restore, rehearse.
- [Postgres 18 upgrade](postgres-18-upgrade.md): once per server that ran Postgres 16.
- [Billing](billing.md)
- [Offline](offline.md): the SPA's local data and write queue, and how to remove it.
- [Security headers](security-headers.md)

## Build

- [Development](development.md): the local stack, every task, the browser tests and what CI runs.
- [Adding a feature](aggregates.md): every file of the notes aggregate, in order.
- [Ids](ids.md): every id is a UUID version 7.
- [Admin modules](admin-modules.md)
- [Woodpecker CI setup](woodpecker-ci-setup.md)
- [Handoff](handoff.md): the map of the repository, decisions made, traps.
- [Contributing](../CONTRIBUTING.md)

## Design

- [Architecture](architecture.md) and [the diagram](architecture.svg)
- [Stack](stack.md)
- [Principles](principles.md)
- [Deno policy](deno-policy.md)
- [Decisions](decisions/): [ADR 001](decisions/001-deno-platform-template.md),
  [ADR 002](decisions/002-realtime-transport-and-sync.md),
  [ADR 003](decisions/003-swappable-transport-and-local-data.md)
- [UI and design](design/)
- [Group sync product requirements](prd/group-sync-platform.md)
- [Financy extraction inventory](financy-extraction-inventory.md)
- [Screenshots](screenshots/): `record.ts` re-records the README's pictures.
