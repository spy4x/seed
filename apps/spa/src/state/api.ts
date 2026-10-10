import { apiFetch as send } from "@spy4x/platform/api"
import { apiRead } from "./realtime-call.ts"

/**
 * Every REST request of the SPA goes through here, and nothing else in the SPA imports the
 * library's `apiFetch` (`tests/spa-reads.test.ts`). A read (`GET`) is sent by {@link apiRead}, so
 * it names the user the page was started for and an `unauthorized` answer signs the page out. A
 * write is sent as it is and names nobody: the call route binds the writes of notes and groups,
 * and the REST writes left (tokens, notifications, the profile, the session) are not bound yet.
 */
export function apiFetch<T>(path: string, init?: RequestInit): ReturnType<typeof send<T>> {
  const method = init?.method?.toUpperCase() ?? "GET"
  return method === "GET" ? apiRead<T>(path, init) : send<T>(path, init)
}
