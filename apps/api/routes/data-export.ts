import { Hono } from "hono"
import type { MiddlewareHandler } from "hono"
import type { DataExportView } from "@domain/identity"
import type { DataExportFile, DataExportRequestResult } from "@server/auth/data-export.ts"
import type { APIContext } from "../_types.ts"
import type { MutationGuards } from "../middlewares/mutation-guards.ts"
import type { SignIn } from "@api/services/sign-in.ts"
import { errorResponse } from "../services/error-response.ts"

/** What the data export routes call. `index.ts` passes the app's singletons; tests pass fakes. */
export interface DataExportRouteDependencies {
  auth: Pick<SignIn["auth"], "isAuthenticated2FA">
  mutationGuards: MutationGuards
  /** The normal per-user budget the session routes spend too. */
  limit: MiddlewareHandler<APIContext>
  latest(userId: number): Promise<DataExportView | null>
  request(userId: number): Promise<DataExportRequestResult>
  readyFile(userId: number): Promise<DataExportFile | null>
  /** Signs a short-lived download of `key` (`FileStore.signDownload`). */
  signDownload(key: string, file: { contentType: string; filename: string }): Promise<string>
}

/** The answer when an export was asked for less than a day ago. */
export const DATA_EXPORT_TOO_SOON = "You can ask for one file a day."

/** The answer when there is no ready file to download. */
export const DATA_EXPORT_NOT_READY = "Your file is not ready, or it expired."

/**
 * A person's copy of their data (#229, docs/data-export.md), mounted at
 * `/api/account/data-export`. Only a signed-in session with its second factor reaches it, and
 * every call reads the session's own person: there is no id to change.
 *
 * - `GET /` answers the newest export: `{ export }`, `null` when there is none.
 * - `POST /` asks for a new one: 201 `{ export }`. One a day: 429 `{ error, code: "TOO_SOON",
 *   export }` with `Retry-After`, where `export` is the one asked for in the last day.
 * - `GET /download` answers 303 to a signed URL of the newest export's file, valid for five
 *   minutes, and 404 when it is not ready or expired. Only the app's own page may ask for it.
 */
export function createDataExportRoute(dependencies: DataExportRouteDependencies): Hono<APIContext> {
  return new Hono<APIContext>()
    .use(dependencies.auth.isAuthenticated2FA)
    .use(dependencies.mutationGuards.signedIn)
    .use(dependencies.limit)
    .get(`/`, async (c) => {
      return c.json({ export: await dependencies.latest(c.get("auth")!.user.id) })
    })
    .post(`/`, async (c) => {
      const result = await dependencies.request(c.get("auth")!.user.id)
      if (!result.success) {
        const waitMs = result.output.nextRequestAt.getTime() - Date.now()
        c.header(`Retry-After`, String(Math.max(1, Math.ceil(waitMs / 1000))))
        return errorResponse(c, `rate_limited`, {
          message: DATA_EXPORT_TOO_SOON,
          reason: result.error,
          details: { export: result.output },
        })
      }
      return c.json({ export: result.output }, 201)
    })
    .get(`/download`, async (c) => {
      // A GET the mutation guards let through: another site must not start the person's download.
      if (c.req.header(`sec-fetch-site`) !== `same-origin`) {
        return errorResponse(c, `forbidden`, { message: `Download must come from the app` })
      }
      const file = await dependencies.readyFile(c.get("auth")!.user.id)
      if (!file) return errorResponse(c, `not_found`, { message: DATA_EXPORT_NOT_READY })
      const url = await dependencies.signDownload(file.key, {
        contentType: `application/zip`,
        filename: file.filename,
      })
      c.header(`Cache-Control`, `no-store`)
      return c.redirect(url, 303)
    })
}
