# Financy → Template extraction inventory

- Status: draft, for triage
- Compiled: 2026-08-19 from the Financy repository at commit `f3a7f5e`
- Purpose: list what is worth lifting out of Financy into this template, and what is not,
  so extraction is a series of small reviewed PRs instead of a copy-paste sweep.

Financy shares this repository's lineage: its `apps/{api,web}` and `libs/{client,server,shared}`
are the layout this repository had before it was split into `apps/{api,spa,mpa,admin,worker}` and
`libs/{platform,domain,server,ui}`. Paths below that name those old folders are Financy's.

## Headline findings

Three things worth knowing before planning any of this work.

1. **Dexie is not implemented in Financy.** `docs/offline-first-with-dexie.md` is a design essay
   with sample code; `grep -ri dexie apps libs` returns nothing. Financy keeps all state in
   in-memory Preact signals. There is no offline-first implementation to extract — the template
   builds it fresh.
2. **Financy's incremental sync never actually runs.** The client sends `SYNC_START` with a
   hardcoded `0` instead of its checkpoint (`apps/web/src/state/ws.ts:282`, TODO: "implement
   proper offline-storage on frontend side to be able to utilize syncedAt timestamp"), so every
   connect is a full re-download of every model. `syncedAt` is an in-memory signal, so it would
   not survive a reload anyway.
3. **Financy sends mutations over WebSocket.** Its WS service imports all 19 CQRS commands and
   dispatches `CREATE`/`UPDATE`/`DELETE`/`UNDELETE`/`TRANSFER` from socket messages.
   [ADR 002](decisions/002-realtime-transport-and-sync.md) adopts that idea - the SPA speaks
   WebSocket - but not this implementation. Financy's socket is the only path, with no sequence
   on a push and no way to detect a gap, so a missed frame silently diverges local state. Here a
   push is stamped with its sequence and a gap falls back to a cursor pull.

## Take as-is (small rework: import paths, `libs/shared` → `libs/platform`)

| Item | Financy path | Why it is worth taking |
| ---- | ------------ | ---------------------- |
| Generic helpers | `libs/shared/helpers/{async,format,string,time,random}.ts` (+ their tests) | Pure, tested utilities with no product coupling. `hash.ts`/`random.ts` already exist here. |
| Local storage wrapper | `libs/shared/local-storage/+index.ts` | Typed persistence wrapper. The template's import map referenced `@shared/local-storage` for a while with no file behind it. |
| Test helpers | `libs/shared/testing/+index.ts` | Same story — the alias existed here with nothing behind it. |
| Preact signal helpers | `libs/client/preact/+signals.tsx` | Reusable reactive-state plumbing for the SPA. |
| URL filter state | `libs/client/preact/use-url-filters.ts` | Generic "filters live in the query string" hook. |
| Cookie helper | `libs/client/browser/cookie.ts` | Small and generic. |
| Icon set | `libs/client/icons/+index.tsx` | Already partially present here; worth reconciling. |
| Request logging middleware | `apps/api/middlewares/log.ts` | The template has `logger()` from Hono only. |
| Log service | `apps/api/services/log.ts` | Consistent structured logging. |
| e2e helpers | `e2e/shared/{auth-helpers,test-helpers}.ts` | Signed-in-session fixtures; needed before any offline→reconnect e2e. |
| DB backup script | `infra/backup/backup.sh`            | Generic ops tooling. |
| Deploy scripts | `infra/scripts/{deploy.ts,+lib.ts}`, `infra/deploy/*.txt` | Deployment file lists and driver; the template's deploy story is thin. |

## Take with redesign (the idea is good, Financy's implementation is not the target)

| Item | Financy path | What changes |
| ---- | ------------ | ------------ |
| WebSocket connection registry | `apps/api/services/websockets.ts` (1232 lines) | Keep: per-user socket map, heartbeat/ping-pong, open/close bookkeeping. Drop: command dispatch, per-model validation, the `LIST` data-push protocol. Target is a few hundred lines of hint-only transport. |
| Reconnect/backoff client | `apps/web/src/state/ws.ts` (319 lines) | Keep the reconnect state machine and heartbeat. Replace `SYNC_START`-over-WS with a REST pull keyed by a persisted cursor. |
| Sync checkpoint | `lastSyncAt` timestamp | Replace with the per-group monotonic `next_change_sequence` cursor already in this schema. Timestamps break on clock skew and cannot order ties. |
| Client-side CQRS | `apps/web/src/cqrs/events.ts`, `apps/web/src/services/eventBus.ts` | The template already has `libs/platform/cqrs`; reconcile rather than copy. |
| Secrets management | `.age/` | Age64 per-value encryption for env files. |
| CI pipeline | `.woodpecker.yml` | The template has `infra/configs/woodpecker-ci.yml` but no active pipeline. |

## Leave in Financy (product-specific)

Currency and money handling
(`libs/shared/{helpers/currency*,helpers/currency-converter*,constants/currency*}`,
`apps/api/services/{currency,exchange-rate-provider}.ts`,
`apps/api/workers/exchange-rate-fetcher.ts`), account balances
(`libs/shared/helpers/account-balance.ts`), the Telegram bot's finance commands
(`apps/api/handlers/telegram/*`), and every `docs/features/*.md` describing budgets, transactions
and dashboards. The bot itself, linking a chat and its notifications are Seed's now
([telegram.md](telegram.md)): Financy registers its commands in `apps/api/telegram/commands.ts`
and drops its own `apps/api/services/telegram/*` and `apps/api/workers/telegram-polling.ts`.

One caveat: **money-as-integers** is a template-level convention worth documenting even though the
currency code itself stays behind. Financy's helpers are a good reference for the arithmetic.

## Do not take (already superseded here)

- `libs/shared/cqrs/*` — this repo has `libs/platform/cqrs`.
- `libs/shared/types/+index.ts` — split here into `libs/platform/types` + `libs/domain/identity`.
- `libs/shared/rpc/+index.ts` — inspect before deciding; likely superseded by the REST/CQRS
  boundary.
- `docs/offline-first-with-dexie.md` — superseded by `docs/design/group-sync.md`, which is
  cursor-based and group-scoped. Keep Financy's doc only as background reading.

## Suggested extraction order

Each line is intended to be one small PR.

1. Generic helpers + local-storage + testing lib (restores three aliases that once dangled here).
2. Logging middleware and log service.
3. e2e auth/test helpers (unblocks any later offline→reconnect test).
4. Preact signal helpers, URL filter hook, cookie helper.
5. Realtime transport — only after the topology decision in
   [realtime design](design/realtime-websockets.md) lands as an ADR.
6. Ops: backup and deploy scripts, then CI, then age64 env encryption.

## Maintenance

Delete rows as they land, and record the resulting PR next to each. When every row is resolved,
delete this file — it is a migration aid, not permanent documentation.
