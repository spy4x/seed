import type { SubscriptionConfirmState, UnsubscribeState } from "@domain/subscribers"
import { readApiError } from "@domain/errors"

/** The `fetch` these calls use; tests pass a fake. */
export type SubscribersFetch = (url: string, init?: RequestInit) => Promise<Response>

/** A token step's answer: its state, and the address while it still asks for the click. */
export interface TokenStep<S extends string> {
  state: S
  email?: string
}

/**
 * Reads `{ state, email? }` from a token route. These routes answer a refused token with a 4xx
 * status and an error whose `reason` is the state, so the body counts on every status. A state
 * outside `known`,
 * a body that is not JSON or a network failure reads as `error`.
 */
async function tokenStep<S extends string>(
  fetcher: SubscribersFetch,
  url: string,
  init: RequestInit,
  known: readonly S[],
): Promise<TokenStep<S | "error">> {
  try {
    const response = await fetcher(url, { credentials: "include", ...init })
    const body = await response.json() as { state?: unknown; email?: unknown }
    // A link that no longer works is refused, and the refusal's reason names the state.
    const said = response.ok ? body.state : readApiError(body)?.reason
    const state = known.find((candidate) => candidate === said)
    if (!state) return { state: "error" }
    return typeof body.email === "string" ? { state, email: body.email } : { state }
  } catch {
    return { state: "error" }
  }
}

const CONFIRM_STATES = ["confirm", "done", "expired", "invalid"] as const
const UNSUBSCRIBE_STATES = ["confirm", "done", "not-recognised"] as const

/** The calls behind the subscribe, confirm and unsubscribe pages. */
export function createSubscribersApi(fetcher: SubscribersFetch = (url, init) => fetch(url, init)) {
  return {
    /**
     * Asks for a confirm link. The API answers the same for every address, so `ok` says only that
     * the request was accepted; `error` is the API's message for a refused one.
     */
    async subscribe(
      email: string,
      list: string,
    ): Promise<{ ok: true } | { ok: false; error: string }> {
      try {
        const response = await fetcher("/api/subscribers", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, list }),
        })
        if (response.ok) return { ok: true }
        return {
          ok: false,
          error: readApiError(await response.json().catch(() => null))?.message ?? "",
        }
      } catch {
        return { ok: false, error: "" }
      }
    },

    /** What a confirm link holds: the address to confirm, or why the link no longer works. */
    previewConfirm(list: string, token: string): Promise<TokenStep<SubscriptionConfirmState>> {
      const query = new URLSearchParams({ list, token })
      return tokenStep(fetcher, `/api/subscribers/confirm?${query}`, {}, CONFIRM_STATES)
    },

    /** Confirms the subscription a link holds. */
    confirm(list: string, token: string): Promise<TokenStep<SubscriptionConfirmState>> {
      return tokenStep(fetcher, "/api/subscribers/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ list, token }),
      }, CONFIRM_STATES)
    },

    /** What an unsubscribe link holds: the address it removes, or that it is not recognised. */
    previewUnsubscribe(list: string, token: string): Promise<TokenStep<UnsubscribeState>> {
      const query = new URLSearchParams({ list, token })
      return tokenStep(
        fetcher,
        `/api/subscribers/unsubscribe/preview?${query}`,
        {},
        UNSUBSCRIBE_STATES,
      )
    },

    /** Removes the address an unsubscribe link holds. The token goes in the form body, not the URL. */
    unsubscribe(list: string, token: string): Promise<TokenStep<UnsubscribeState>> {
      return tokenStep(
        fetcher,
        `/api/subscribers/unsubscribe?${new URLSearchParams({ list })}`,
        { method: "POST", body: new URLSearchParams({ token }) },
        UNSUBSCRIBE_STATES,
      )
    },
  }
}

export const subscribersApi = createSubscribersApi()
