import { Hono } from "hono"
import type { MiddlewareHandler } from "hono"
import type { APIContext } from "../_types.ts"
import type { MutationGuards } from "../middlewares/mutation-guards.ts"
import type { SignIn } from "@api/services/sign-in.ts"
import type { TelegramAccounts } from "@api/services/telegram.ts"
import { errorResponse } from "../services/error-response.ts"

/** What the person's Telegram routes call. `index.ts` passes the app's singletons. */
export interface TelegramRouteDependencies {
  auth: Pick<SignIn["auth"], "isAuthenticated2FA">
  mutationGuards: MutationGuards
  /** The normal per-user budget the session routes spend too. */
  limit: MiddlewareHandler<APIContext>
  /** The stricter per-user budget a new link code spends. */
  codeLimit: MiddlewareHandler<APIContext>
  telegram: TelegramAccounts
}

/** The answer while the bot is off. */
export const TELEGRAM_OFF = "Telegram is not set up here"

/**
 * The person's Telegram link (#269), mounted at `/api/telegram`. Only a signed-in session with its
 * second factor reaches it: a linked chat acts as the person, so linking needs their full session.
 *
 * - `GET /` answers whether the bot is on and when the person linked: `TelegramStatusResponse`.
 * - `POST /code` makes a link code, valid 10 minutes and once, in place of the last one:
 *   `TelegramLinkCodeResponse`, never cached. 404 while the bot is off; refused for a guest.
 * - `DELETE /` unlinks: `{ unlinked }`, `false` when nothing was linked.
 */
export function createTelegramRoute(dependencies: TelegramRouteDependencies): Hono<APIContext> {
  const { telegram } = dependencies
  return new Hono<APIContext>()
    .use(dependencies.auth.isAuthenticated2FA)
    .use(dependencies.mutationGuards.signedIn)
    .use(dependencies.limit)
    .get(`/`, async (c) => c.json(await telegram.status(c.get("auth")!.user.id)))
    .post(`/code`, dependencies.codeLimit, async (c) => {
      const code = await telegram.issueCode(c.get("auth")!.user.id)
      if (!code) return errorResponse(c, `not_found`, { message: TELEGRAM_OFF })
      c.header(`Cache-Control`, `no-store`)
      return c.json(code)
    })
    .delete(`/`, async (c) => {
      return c.json({ unlinked: await telegram.unlink(c, c.get("auth")!.user.id) })
    })
}

/**
 * Telegram's webhook, mounted at `/api/webhooks/telegram`. It takes no session: the secret Telegram
 * sends in `X-Telegram-Bot-Api-Secret-Token` is the only proof, compared in constant time before
 * the body is read (`createTelegramWebhookHandler`). 404 while the bot is off or polls.
 */
export function createTelegramWebhookRoute(
  handle: ((request: Request) => Promise<Response>) | null,
): Hono<APIContext> {
  return new Hono<APIContext>().all(`/`, (c) => {
    if (!handle) return errorResponse(c, `not_found`, { message: TELEGRAM_OFF })
    return handle(c.req.raw)
  })
}
