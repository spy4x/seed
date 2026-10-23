import type { LeaveGuard } from "@spy4x/preact-ui/unsaved-guard"

/** The router's `navigate`: go to `href`, replacing the current history entry when asked. */
export type Navigate = (href: string, options?: { replace?: boolean }) => void

/**
 * `navigate` that asks first through `guard`: while a page's `UnsavedGuard` holds unsaved changes,
 * a navigation from code (a `g` shortcut, a sidebar button, a module's redirect) opens that page's
 * "Leave without saving?" dialog instead of dropping the changes. With nothing unsaved it goes at
 * once.
 *
 * An `UnsavedGuard`'s own `navigate` prop takes the router's plain `navigate`, never this one: the
 * guard calls it after "Leave", and this one would ask again.
 */
export function guardNavigate(guard: LeaveGuard, navigate: Navigate): Navigate {
  return (href, options) => guard.navigate(() => navigate(href, options))
}
