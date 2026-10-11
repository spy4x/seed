import { Hono } from "hono"
import type { Context, MiddlewareHandler } from "hono"
import { type } from "arktype"
import {
  BillingCheckoutCommand,
  billingCheckoutRequestSchema,
  BillingGetQuery,
  BillingPortalCommand,
  type BillingRedirect,
  type GroupBilling,
} from "@domain/billing"
import { isUuid } from "@spy4x/platform/universal/uuid"
import { createSameOriginMutationGuard } from "@spy4x/server/http/same-origin"
import { actorFromAuth } from "../cqrs/actor.ts"
import type { APIContext } from "../_types.ts"
import { billingErrorResponse, BillingFeatureError } from "../features/billing/errors.ts"
import { readFeatureJson } from "@api/services/json-body.ts"

export interface BillingRouteDependencies {
  get(query: BillingGetQuery): Promise<{ billing: GroupBilling }>
  checkout(command: BillingCheckoutCommand): Promise<BillingRedirect>
  portal(command: BillingPortalCommand): Promise<BillingRedirect>
  /** The origin the browser sends; see `GroupsRouteDependencies.expectedOrigin`. */
  expectedOrigin?: string
}

/**
 * A group's billing, mounted at `/api/groups/:groupId/billing`. It parses, names the actor and
 * dispatches; who may act is decided by the handlers.
 *
 * - `GET /` reads the group's plan: any member.
 * - `POST /checkout` `{ planId }` answers `{ url }`, the provider's checkout page: the owner only.
 * - `POST /portal` answers `{ url }`, the provider's portal: the owner only.
 *
 * Both posts need the web app's origin and accept an `Idempotency-Key` header.
 */
export function createBillingRoute(dependencies: BillingRouteDependencies): Hono<APIContext> {
  const requireSameOrigin = createSameOriginMutationGuard<APIContext>({
    expectedOrigin: dependencies.expectedOrigin,
    onReject: (c) =>
      billingErrorResponse(
        c,
        new BillingFeatureError("REQUEST_ORIGIN_INVALID", "Mutation origin check failed"),
      ),
  })
  return new Hono<APIContext>()
    .onError((error, c) => billingErrorResponse(c, error))
    .use(requireAuthentication)
    .get("/", async (c) => {
      return c.json(
        await dependencies.get(new BillingGetQuery({ actor: actorOf(c), groupId: groupIdOf(c) })),
      )
    })
    .post("/checkout", requireSameOrigin, async (c) => {
      const input = billingCheckoutRequestSchema(await readJson(c))
      if (input instanceof type.errors) {
        throw new BillingFeatureError("INVALID_REQUEST", input.summary)
      }
      return c.json(
        await dependencies.checkout(
          new BillingCheckoutCommand({
            actor: actorOf(c),
            groupId: groupIdOf(c),
            planId: input.planId,
            idempotencyKey: c.req.header("idempotency-key"),
          }),
        ),
      )
    })
    .post("/portal", requireSameOrigin, async (c) => {
      return c.json(
        await dependencies.portal(
          new BillingPortalCommand({
            actor: actorOf(c),
            groupId: groupIdOf(c),
            idempotencyKey: c.req.header("idempotency-key"),
          }),
        ),
      )
    })
}

/** Authentication only; the session gate on the buses decides whether the session is strong enough. */
const requireAuthentication: MiddlewareHandler<APIContext> = async (c, next) => {
  if (!c.get("auth")) {
    return billingErrorResponse(c, new BillingFeatureError("AUTH_REQUIRED", "Missing session"))
  }
  return await next()
}

function actorOf(c: Context<APIContext>) {
  return actorFromAuth(c.get("auth")!)
}

function groupIdOf(c: Context<APIContext>): string {
  const groupId = c.req.param("groupId")
  if (!isUuid(groupId)) throw new BillingFeatureError("INVALID_REQUEST", "Group id is invalid")
  return groupId
}

async function readJson(c: Context<APIContext>): Promise<unknown> {
  return readFeatureJson(c, (message) => new BillingFeatureError("INVALID_REQUEST", message))
}
