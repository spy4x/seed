import { isInvitationPath, NEXT_PARAM, SCREEN_PATHS, withNext } from "@ui/progressive.tsx"
import type { SessionState } from "../state/session.ts"
import { isMembersOnlyPath } from "./spa-paths.ts"

/**
 * Where a visit to `path` goes when the session is not fully signed in: to sign-in, or to the code
 * page while the code is owed, with the page as `next` (its `search` too, given without the `?`)
 * so sign-in returns there. An invitation goes to sign-up instead: most invited people have no
 * account yet, and sign-up links to sign-in for those who do. `null` when the page stays: the session is signed in, or the page is
 * open to anyone, which the route table says (`spa-paths.ts`). The MPA's pages answer the same way
 * on the server (`signInPath`).
 */
export function signInRedirect(
  path: string,
  search: string,
  session: Pick<SessionState, "user" | "isMfaRequired">,
): string | null {
  if ((session.user && !session.isMfaRequired) || !isMembersOnlyPath(path)) return null
  const page = search ? `${path}?${search}` : path
  const target = session.isMfaRequired
    ? SCREEN_PATHS.oneTimeCode
    : isInvitationPath(path)
    ? SCREEN_PATHS.signUp
    : SCREEN_PATHS.signIn
  return withNext(target, page)
}

/**
 * Where a sign-out made on `path` goes first: plain sign-in, with no `next`, when the page is one
 * for signed-in people or carries a `next` (`search` without its `?`). Otherwise the sign-in gate
 * would keep the page as `next`, and the next person on a shared device would land on the
 * previous person's note. `null` when the page stays, as the profile does. A sign-out made in
 * another tab still leaves this tab's page as `next`; the page is checked as any `next` is.
 */
export function signOutRedirect(path: string, search: string): string | null {
  return isMembersOnlyPath(path) || new URLSearchParams(search).has(NEXT_PARAM)
    ? SCREEN_PATHS.signIn
    : null
}
