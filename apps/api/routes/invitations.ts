import { Hono } from "hono"
import type { Context, MiddlewareHandler } from "hono"
import {
  type GroupInvitation,
  GroupInvitationAcceptCommand,
  type GroupInvitationAcceptResult,
  GroupInvitationCreateCommand,
  type GroupInvitationCreateResult,
  GroupInvitationDeclineCommand,
  GroupInvitationRevokeCommand,
  GroupInvitationsQuery,
  type InvitationPreview,
  InvitationPreviewQuery,
  MyInvitationsQuery,
  parseGroupId,
  parseInvitationCreateBody,
  parseInvitationId,
  parseInvitationRef,
  parseInvitationTokenBody,
} from "@domain/groups"
import { createSameOriginMutationGuard } from "@spy4x/server/http/same-origin"
import { actorFromAuth } from "../cqrs/actor.ts"
import type { APIContext } from "../_types.ts"
import { GroupFeatureError } from "../features/groups/errors.ts"
import { invitationErrorResponse } from "../features/groups/invitation-errors.ts"
import type { InvitationRateLimits } from "../features/groups/invitation-rate-limits.ts"
import { readFeatureJson } from "@api/services/json-body.ts"

export interface InvitationsRouteDependencies {
  create(command: GroupInvitationCreateCommand): Promise<GroupInvitationCreateResult>
  list(query: GroupInvitationsQuery): Promise<{ invitations: GroupInvitation[] }>
  revoke(command: GroupInvitationRevokeCommand): Promise<{ revoked: true }>
  preview(query: InvitationPreviewQuery): Promise<{ invitation: InvitationPreview }>
  mine(query: MyInvitationsQuery): Promise<{ invitations: InvitationPreview[] }>
  accept(command: GroupInvitationAcceptCommand): Promise<GroupInvitationAcceptResult>
  decline(command: GroupInvitationDeclineCommand): Promise<{ declined: true }>
  rateLimits: Pick<InvitationRateLimits, "createByUser" | "answerByIp">
  /** The origin the browser sends; see `GroupsRouteDependencies.expectedOrigin`. */
  expectedOrigin?: string
}

/**
 * A group's invitations, mounted at `/api/groups/:groupId/invitations`. Who may list, create or
 * revoke is decided by the handlers.
 *
 * - `GET /` lists the pending ones, newest first.
 * - `POST /` creates `{ role, expiresInDays?, maxUses?, email?, sendEmail?, acceptSeatPrice? }`:
 *   201 with the invitation and its token, shown this once. No `Idempotency-Key`: the answer
 *   carries the token, which must never be stored. A group billed per member needs
 *   `acceptSeatPrice: true` from its owner or an admin.
 * - `DELETE /:invitationId` revokes one.
 */
export function createGroupInvitationsRoute(
  dependencies: InvitationsRouteDependencies,
): Hono<APIContext> {
  const requireSameOrigin = sameOriginGuard(dependencies.expectedOrigin)
  return new Hono<APIContext>()
    .onError((error, c) => invitationErrorResponse(c, error))
    .use(requireAuthentication)
    .get("/", async (c) =>
      c.json(
        await dependencies.list(
          new GroupInvitationsQuery({ actor: actorOf(c), groupId: groupIdOf(c) }),
        ),
      ))
    .post("/", requireSameOrigin, dependencies.rateLimits.createByUser, async (c) => {
      const input = parseInvitationCreateBody(await readJson(c))
      const result = await dependencies.create(
        new GroupInvitationCreateCommand({
          actor: actorOf(c),
          groupId: groupIdOf(c),
          ...input,
          requestId: c.get("requestId"),
        }),
      )
      return c.json(result, 201)
    })
    .delete("/:invitationId", requireSameOrigin, async (c) =>
      c.json(
        await dependencies.revoke(
          new GroupInvitationRevokeCommand({
            actor: actorOf(c),
            groupId: groupIdOf(c),
            invitationId: parseInvitationId(c.req.param("invitationId")),
            requestId: c.get("requestId"),
          }),
        ),
      ))
}

/**
 * The invited person's side, mounted at `/api/invitations`. The token travels in the body, never in
 * a URL the API logs. Opening, accepting and declining spend the per-IP invitation budget.
 *
 * - `POST /preview` with `{ token }`: the group, the inviter and the role, or why it no longer works.
 * - `GET /mine`: the pending invitations tied to an address the person proved.
 * - `POST /accept` and `POST /decline` with `{ token }` or `{ invitationId }`.
 */
export function createInvitationsRoute(
  dependencies: InvitationsRouteDependencies,
): Hono<APIContext> {
  const requireSameOrigin = sameOriginGuard(dependencies.expectedOrigin)
  const { answerByIp } = dependencies.rateLimits
  return new Hono<APIContext>()
    .onError((error, c) => invitationErrorResponse(c, error))
    .use(requireAuthentication)
    .get(
      "/mine",
      async (c) => c.json(await dependencies.mine(new MyInvitationsQuery({ actor: actorOf(c) }))),
    )
    // A read, sent as a POST so the token stays out of the URL; it changes nothing, so it skips
    // the origin check.
    .post("/preview", answerByIp, async (c) => {
      const { token } = parseInvitationTokenBody(await readJson(c))
      return c.json(
        await dependencies.preview(new InvitationPreviewQuery({ actor: actorOf(c), token })),
      )
    })
    .post("/accept", requireSameOrigin, answerByIp, async (c) =>
      c.json(
        await dependencies.accept(
          new GroupInvitationAcceptCommand({
            actor: actorOf(c),
            invitation: parseInvitationRef(await readJson(c)),
            requestId: c.get("requestId"),
          }),
        ),
      ))
    .post("/decline", requireSameOrigin, answerByIp, async (c) =>
      c.json(
        await dependencies.decline(
          new GroupInvitationDeclineCommand({
            actor: actorOf(c),
            invitation: parseInvitationRef(await readJson(c)),
            requestId: c.get("requestId"),
          }),
        ),
      ))
}

function sameOriginGuard(expectedOrigin: string | undefined): MiddlewareHandler<APIContext> {
  return createSameOriginMutationGuard<APIContext>({
    expectedOrigin,
    onReject: (c) =>
      invitationErrorResponse(
        c,
        new GroupFeatureError("REQUEST_ORIGIN_INVALID", "Mutation origin check failed"),
      ),
  })
}

/** Authentication only; the session gate on the buses decides whether the session is strong enough. */
const requireAuthentication: MiddlewareHandler<APIContext> = async (c, next) => {
  if (!c.get("auth")) {
    return invitationErrorResponse(c, new GroupFeatureError("AUTH_REQUIRED", "Missing session"))
  }
  return await next()
}

function actorOf(c: Context<APIContext>) {
  return actorFromAuth(c.get("auth")!)
}

function groupIdOf(c: Context<APIContext>): string {
  return parseGroupId(c.req.param("groupId"))
}

async function readJson(c: Context<APIContext>): Promise<unknown> {
  return readFeatureJson(c, (message) => new GroupFeatureError("INVALID_REQUEST", message))
}
