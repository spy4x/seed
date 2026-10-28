import type { Context, MiddlewareHandler } from "hono"
import { Hono } from "hono"
import { requestInfoFromContext } from "@spy4x/platform/request-info"
import { isUuid } from "@spy4x/platform/universal/uuid"
import {
  ADMIN_API_TOKENS_PAGE_SIZE,
  ADMIN_USER_API_TOKENS_LIMIT,
  type AdminApiTokenFilter,
  type AdminApiTokenListResponse,
  type AdminUserApiTokensResponse,
  parseAdminApiTokenFilter,
} from "@domain/api-tokens"
import { type AdminPushDevicesResponse, AuthAuditEventType } from "@domain/identity"
import { ADMIN_NOTIFICATIONS_LIMIT, type AdminNotificationsResponse } from "@domain/notifications"
import { PushDevicesUpdatedEvent } from "@api/cqrs/events.ts"
import type { AppDbBase } from "@api/services/db-base.ts"
import { operatorIdentifier } from "@api/services/admin.ts"
import { requestOf } from "@api/services/api-tokens.ts"
import { type AppAuthState, auditRow } from "@api/services/sign-in.ts"
import type { APIContext } from "../../_types.ts"
import type { AdminApiModule } from "./module.ts"
import { ADMIN_OUTRANKED, ADMIN_SELF, ADMIN_USER_NOT_FOUND } from "./users.ts"
import { codeForStatus, errorResponse } from "../../services/error-response.ts"

/** How an operator's revoke or remove ended. */
export enum AdminApiTokensOutcome {
  Done = 1,
  /** No live person, or no token of a live person, has that id. */
  UserNotFound = 2,
  /** The token or device belongs to the operator. */
  Self = 3,
  /** Its owner's role is the operator's own or higher. */
  Outranked = 4,
  /** The person has no such live device, or the token is revoked already. */
  Unchanged = 5,
}

export const ADMIN_TOKEN_NOT_FOUND = "API token not found"
export const ADMIN_TOKEN_ALREADY_REVOKED = "This API token is already revoked"
export const ADMIN_DEVICE_NOT_FOUND = "Device not found"

/** The operator area's reads and actions over tokens, devices and notifications (#427). */
export interface AdminApiTokensService {
  list(filter: AdminApiTokenFilter): Promise<AdminApiTokenListResponse>
  /** The person's tokens, or `null` when there is no live person `userId`. */
  userTokens(userId: number): Promise<AdminUserApiTokensResponse | null>
  devices(userId: number): Promise<AdminPushDevicesResponse | null>
  notifications(userId: number): Promise<AdminNotificationsResponse | null>
  /**
   * Revokes the token `tokenId` on behalf of `actor`, with its audit row on the owner naming the
   * operator, in one statement. The owner's role is read under a lock, in the same transaction.
   */
  revoke(c: Context, actor: AppAuthState, tokenId: string): Promise<AdminApiTokensOutcome>
  /**
   * Removes the person's push device on behalf of `actor`, with its audit row on the person, in one
   * transaction. Answers the devices left on success, for the event that refreshes their tabs.
   */
  removeDevice(
    c: Context,
    actor: AppAuthState,
    userId: number,
    deviceRowId: number,
  ): Promise<
    { outcome: AdminApiTokensOutcome; devices?: PushDevicesUpdatedEvent["data"]["devices"] }
  >
}

/**
 * Builds the service over the app's database. An operator never acts on their own token or device
 * here, nor on a person whose role is theirs or higher, as with blocking (`services/admin.ts`).
 */
export function createAdminApiTokens(
  { db, now = () => new Date() }: { db: AppDbBase; now?: () => Date },
): AdminApiTokensService {
  /** Locks the live person and says whether `actor` may act on them, inside `tx`. */
  async function mayActOn(tx: AppDbBase, actor: AppAuthState, userId: number) {
    const target = await tx.admin.lockTarget(userId)
    if (!target) return AdminApiTokensOutcome.UserNotFound
    if (target.role >= actor.user.role) return AdminApiTokensOutcome.Outranked
    return AdminApiTokensOutcome.Done
  }

  return {
    async list(filter) {
      const result = await db.adminApiTokens.list(filter, ADMIN_API_TOKENS_PAGE_SIZE, now())
      return { ...result, page: filter.page, pageSize: ADMIN_API_TOKENS_PAGE_SIZE }
    },

    async userTokens(userId) {
      if (!(await db.admin.find(userId))) return null
      return {
        tokens: await db.adminApiTokens.listForUser(userId, ADMIN_USER_API_TOKENS_LIMIT, now()),
      }
    },

    async devices(userId) {
      if (!(await db.admin.find(userId))) return null
      return { devices: await db.adminApiTokens.devices(userId) }
    },

    async notifications(userId) {
      if (!(await db.admin.find(userId))) return null
      return await db.adminApiTokens.notifications(userId, ADMIN_NOTIFICATIONS_LIMIT)
    },

    async revoke(c, actor, tokenId) {
      const ownerId = await db.adminApiTokens.owner(tokenId)
      if (ownerId === null) return AdminApiTokensOutcome.UserNotFound
      if (ownerId === actor.user.id) return AdminApiTokensOutcome.Self
      return await db.begin(async (tx) => {
        const may = await mayActOn(tx, actor, ownerId)
        if (may !== AdminApiTokensOutcome.Done) return may
        const revoked = await tx.apiTokens.revoke(
          { userId: ownerId, tokenId },
          `operator:${actor.user.id}`,
          requestOf(c),
        )
        return revoked > 0 ? AdminApiTokensOutcome.Done : AdminApiTokensOutcome.Unchanged
      })
    },

    async removeDevice(c, actor, userId, deviceRowId) {
      if (userId === actor.user.id) return { outcome: AdminApiTokensOutcome.Self }
      return await db.begin(async (tx) => {
        const may = await mayActOn(tx, actor, userId)
        if (may !== AdminApiTokensOutcome.Done) return { outcome: may }
        const devices = await tx.adminApiTokens.removeDevice(userId, deviceRowId)
        if (devices === null) return { outcome: AdminApiTokensOutcome.Unchanged }
        await tx.authAudit.insert(
          auditRow(
            c,
            userId,
            AuthAuditEventType.PUSH_DEVICE_REMOVED,
            `${operatorIdentifier(actor.user.id)} device=${deviceRowId}`,
          ),
        )
        return { outcome: AdminApiTokensOutcome.Done, devices }
      })
    },
  }
}

/** What the routes call. */
export interface AdminApiTokensRouteDependencies {
  /** The normal per-user budget the session routes spend too. */
  limit: MiddlewareHandler<APIContext>
  service: AdminApiTokensService
  emit(event: PushDevicesUpdatedEvent): void
}

/** A row id from the path, or `null` when it is no positive integer Postgres' INT4 can hold. */
function intIdOf(raw: string): number | null {
  if (!/^[1-9]\d{0,9}$/.test(raw)) return null
  const id = Number(raw)
  return id <= 2_147_483_647 ? id : null
}

/**
 * The routes of the `api-tokens` module (#427), mounted at `/api/admin` behind the gate in
 * `+routes.ts`: only an operator with a full session reaches them. No answer carries a token's
 * secret or hash, a device's endpoint or keys, or a notification's payload.
 *
 * - `GET /api-tokens?state=&page=` lists every live person's tokens, newest first:
 *   `{ tokens, total, page, pageSize, counts }`. `state` is `live`, `expired` or `revoked`.
 * - `POST /api-tokens/:id/revoke` takes no body and answers `{ ok: true }`. Its audit row on the
 *   owner says `reason=operator:<id>`.
 * - `GET /users/:id/api-tokens`, `/devices` and `/notifications` are one person's: 404 for no live
 *   person.
 * - `POST /users/:id/devices/:deviceId/remove` takes no body and answers `{ ok: true }`, writes
 *   `PUSH_DEVICE_REMOVED` on the person and tells their open tabs to read their devices again.
 *
 * An action on one's own token or device answers 403, as one on a role at or above the operator's.
 */
export function createAdminApiTokensRoutes(
  { limit, service, emit }: AdminApiTokensRouteDependencies,
): Hono<APIContext> {
  /** The refusal of an action that did not go through, or `null` when it did. */
  function refusal(c: Context, outcome: AdminApiTokensOutcome, unchanged: [string, 404 | 409]) {
    switch (outcome) {
      case AdminApiTokensOutcome.Done:
        return null
      case AdminApiTokensOutcome.UserNotFound:
        return errorResponse(c, `not_found`, { message: ADMIN_USER_NOT_FOUND })
      case AdminApiTokensOutcome.Self:
        return errorResponse(c, `forbidden`, { message: ADMIN_SELF })
      case AdminApiTokensOutcome.Outranked:
        return errorResponse(c, `forbidden`, { message: ADMIN_OUTRANKED })
      case AdminApiTokensOutcome.Unchanged:
        return errorResponse(c, codeForStatus(unchanged[1]), {
          message: unchanged[0],
          status: unchanged[1],
        })
    }
  }

  return new Hono<APIContext>()
    .get(`/api-tokens`, limit, async (c) => {
      const filter = parseAdminApiTokenFilter(new URL(c.req.url).searchParams)
      return c.json(await service.list(filter))
    })
    .post(`/api-tokens/:id/revoke`, limit, async (c) => {
      const tokenId = c.req.param("id")
      if (!isUuid(tokenId)) return errorResponse(c, `not_found`, { message: ADMIN_TOKEN_NOT_FOUND })
      const outcome = await service.revoke(c, c.get("auth")!, tokenId)
      if (outcome === AdminApiTokensOutcome.UserNotFound) {
        return errorResponse(c, `not_found`, { message: ADMIN_TOKEN_NOT_FOUND })
      }
      return refusal(c, outcome, [ADMIN_TOKEN_ALREADY_REVOKED, 409]) ?? c.json({ ok: true })
    })
    .get(`/users/:id/api-tokens`, limit, async (c) => {
      const userId = intIdOf(c.req.param("id"))
      const answer = userId === null ? null : await service.userTokens(userId)
      return answer
        ? c.json(answer)
        : errorResponse(c, `not_found`, { message: ADMIN_USER_NOT_FOUND })
    })
    .get(`/users/:id/devices`, limit, async (c) => {
      const userId = intIdOf(c.req.param("id"))
      const answer = userId === null ? null : await service.devices(userId)
      return answer
        ? c.json(answer)
        : errorResponse(c, `not_found`, { message: ADMIN_USER_NOT_FOUND })
    })
    .get(`/users/:id/notifications`, limit, async (c) => {
      const userId = intIdOf(c.req.param("id"))
      const answer = userId === null ? null : await service.notifications(userId)
      return answer
        ? c.json(answer)
        : errorResponse(c, `not_found`, { message: ADMIN_USER_NOT_FOUND })
    })
    .post(`/users/:id/devices/:deviceId/remove`, limit, async (c) => {
      const userId = intIdOf(c.req.param("id"))
      if (userId === null) return errorResponse(c, `not_found`, { message: ADMIN_USER_NOT_FOUND })
      const deviceRowId = intIdOf(c.req.param("deviceId"))
      if (deviceRowId === null) {
        return errorResponse(c, `not_found`, { message: ADMIN_DEVICE_NOT_FOUND })
      }
      const { outcome, devices } = await service.removeDevice(
        c,
        c.get("auth")!,
        userId,
        deviceRowId,
      )
      const refused = refusal(c, outcome, [ADMIN_DEVICE_NOT_FOUND, 404])
      if (refused) return refused
      emit(
        new PushDevicesUpdatedEvent({
          userId,
          devices: devices ?? [],
          request: requestInfoFromContext(c, { trustedProxy: true }),
        }),
      )
      return c.json({ ok: true })
    })
}

/** The `api-tokens` module: every API token, and a person's tokens, devices and notifications. */
export const apiTokensAdminModule: AdminApiModule = {
  id: `api-tokens`,
  routes: ({ db, limit, emit, now }) =>
    createAdminApiTokensRoutes({ limit, emit, service: createAdminApiTokens({ db, now }) }),
}
