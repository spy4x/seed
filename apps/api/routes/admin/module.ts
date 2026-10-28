import type { FileStore, ServerFiles } from "@server/files/files.ts"
import type { CatalogSetup } from "@server/catalog/setup.ts"
import type { WebsiteStatsContext } from "./stats.ts"
import type { Hono, MiddlewareHandler } from "hono"
import type { RateLimitDecision } from "@spy4x/platform/rate-limit"
import type postgres from "postgres"
import type { BillingProvider } from "@spy4x/billing"
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
   * Spends one of an address's reset links, from the budget "Forgot password" spends too
   * (`createAuthRateLimits().resetByAddress`). Throws when its store fails.
   */
  resetByAddress(email: string): Promise<RateLimitDecision>
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
  /** Whether the file store answers, for the System page (#392). */
  fileStoreReachable(): Promise<boolean>
  /** Reads a small file from the file store (`FileStore.read`). */
  readFile: FileStore["read"]
  /** The release tag and commit the API was built from, or `null` each for a local build (#429). */
  build: { version: string | null; commit: string | null }
  /**
   * The public website's address from `MPA_DOMAIN` (`readSiteUrl`), or `null` while it is not
   * deployed. Read on its own, so it holds while the newsletter is off.
   */
  siteUrl: string | null
  /** The payment provider for the billing module (#196); `provider` is `null` while billing is off. */
  billing: {
    provider: Required<BillingProvider> | null
    graceDays: number
    dashboardUrl: string | null
  }
  /** Whether the catalog is on (`CATALOG=true`), with its currency and languages (#466). */
  catalog: CatalogSetup
  /** The file store's server-side writes, for files that pass through the API (#466). */
  files: Pick<ServerFiles, `put` | `read` | `delete`>
  /** Stats' Umami settings, or which are missing, and the website's item address (#485). */
  websiteStats: WebsiteStatsContext
}

/**
 * One module of the operator area's API (`docs/admin-modules.md`). Its routes are mounted under
 * `/api/admin` behind the gate in `+routes.ts`, which has already refused anyone below operator
 * and every cross-site write, so a module adds no check of its own for either.
 */
export interface AdminApiModule {
  /** The same id as the admin app's module (`apps/admin/src/modules/`). */
  id: string
  /**
   * Whether the module is on, for a module a product turns on with a setting. Off, its routes are
   * not mounted and `GET /api/admin/modules` leaves it out, so the admin app hides it. Omitted: on.
   */
  enabled?(context: AdminModuleContext): boolean
  routes(context: AdminModuleContext): Hono<APIContext>
}
