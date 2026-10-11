import { apiFetch as send } from "@spy4x/platform/api"
import { apiAsUser } from "./realtime-call.ts"

/**
 * Every REST request of the SPA goes through here, and nothing else in the SPA imports the
 * library's `apiFetch` (`tests/spa-reads.test.ts`). A request, read or write, is sent by
 * {@link apiAsUser}: it names the user the page was started for, and an `unauthorized` answer signs
 * the page out. The server refuses a request whose page names another user than the session's
 * (`requireBoundUser`), so a stale tab never writes to the account that signed in beside it.
 */
export function apiFetch<T>(path: string, init?: RequestInit): ReturnType<typeof send<T>> {
  return apiAsUser<T>(path, init)
}
