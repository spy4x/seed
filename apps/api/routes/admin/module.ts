import type { Hono, MiddlewareHandler } from "hono"
import type postgres from "postgres"
import type { PushDevicesUpdatedEvent, UserSignedOutEvent } from "@api/cqrs/events.ts"
import type { AppDbBase } from "@api/services/db-base.ts"
import type { SubscribersSetup } from "@server/subscribers/subscribers.ts"
import type { APIContext } from "../../_types.ts"

/** The answer to anyone below operator, on every path: the area does not exist for them. */
export const ADMIN_NOT_FOUND = "Not found"

/** What every operator-area module may build its routes from. `index.ts` passes the singletons. */
export interface AdminModuleContext {
  db: AppDbBase
  /** The raw client, for the reads and library stores `db` does not wrap. */
  sql: postgres.Sql
  /** The mail subscriptions' keys, or `null` when they are off. */
  subscribers: SubscribersSetup | null
  /** The normal per-user budget the session routes spend too. Every module route spends it. */
  limit: MiddlewareHandler<APIContext>
  /**
   * Closes a person's sockets after their sessions end, or tells their open tabs that their push
   * devices changed.
   */
  emit(event: UserSignedOutEvent | PushDevicesUpdatedEvent): void
  now(): Date
  /** The secret that signs the audit log's page cursors (#429), the one note cursors use. */
  cursorSecret: string
  /** Whether the cache (Valkey) answers, for the System page (#429). */
  cacheConnected(): Promise<boolean>
  /** The release tag and commit the API was built from, or `null` each for a local build (#429). */
  build: { version: string | null; commit: string | null }
}

/**
 * One module of the operator area's API (`docs/admin-modules.md`). Its routes are mounted under
 * `/api/admin` behind the gate in `+routes.ts`, which has already refused anyone below operator
 * and every cross-site write, so a module adds no check of its own for either.
 */
export interface AdminApiModule {
  /** The same id as the admin app's module (`apps/admin/src/modules/`). */
  id: string
  routes(context: AdminModuleContext): Hono<APIContext>
}
