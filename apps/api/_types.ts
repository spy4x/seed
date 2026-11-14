import type { RequestIdVariables } from "hono/request-id"
import type { AppAuthState } from "./services/sign-in.ts"

export interface APIContext {
  Variables: RequestIdVariables & {
    /**
     * The signed-in user and session, set by `parseAuth`; `null` when the request has no valid
     * session. Behind `isAuthenticated1FA` or `isAuthenticated2FA` it is never `null`.
     */
    auth: AppAuthState | null
    /**
     * `true` on a request of the public demo's admin account to the operator area
     * (`routes/admin/demo-guard.ts`); unset otherwise.
     */
    publicDemoAdmin?: boolean
  }
}
