import { signal } from "@preact/signals"
import type { ApiResult } from "@spy4x/platform/api"
import {
  type GroupBilling,
  type PersonTrial,
  providerPageUrl,
  readGroupBilling,
  readPersonTrial,
} from "@domain/billing"
import { apiFetch } from "./api.ts"
import { type LocalReads, localReads, noLocalReads } from "../modules.ts"
import { READ_KEYS } from "./read-keys.ts"
import { ReadRefused } from "@spy4x/realtime/read-cache"

/** `apiFetch`, or a test's stand-in for it. */
export type BillingFetch = <T>(url: string, init?: RequestInit) => Promise<ApiResult<T>>

const OFFLINE = "The server is out of reach. Try again."
const UNREADABLE = "The plan could not be read."
const UNSAFE_PAGE = "The payment provider answered with an address this app does not open."
const CHECKOUT_UNREACHABLE =
  "Could not open Stripe's checkout. Check your connection and try again."
const PORTAL_UNREACHABLE =
  "Could not open Stripe's billing page. Check your connection and try again."

function billingPath(groupId: string, action = ""): string {
  return `/api/groups/${encodeURIComponent(groupId)}/billing${action}`
}

/**
 * One group's plan, and the two ways its owner changes it: the provider's checkout and its portal.
 * Both leave the app for the provider's page; the plan itself changes when the provider's webhook
 * arrives, and the page reads it again when the group's change sequence moves.
 *
 * `leave` opens the provider's page; tests pass a stand-in for `location.assign`. The plan last
 * read is kept on the device (`device`) and shown when the server is unreachable; checkout and the
 * portal need the server.
 */
export function createBillingStore(
  fetch: BillingFetch = apiFetch,
  leave: (url: string) => void = (url) => globalThis.location.assign(url),
  device: LocalReads = noLocalReads,
) {
  /** The billing of the group last read, with its id, so another group's page shows none of it. */
  const current = signal<{ groupId: string; billing: GroupBilling } | null>(null)
  /**
   * Why the last read or the last checkout or portal failed, with the group it was for. `id` is new
   * on every failure, so a screen moves focus to the message even when the text repeats.
   */
  const error = signal<{ groupId: string; message: string; id: number } | null>(null)
  let refusals = 0
  /** A checkout or portal call is in flight. */
  const pending = signal(false)

  async function load(groupId: string): Promise<void> {
    try {
      const { value: billing } = await device.through(
        READ_KEYS.billing(groupId),
        async () => {
          const result = await fetch<{ billing: unknown }>(billingPath(groupId))
          if (!result.ok) {
            throw new ReadRefused(result.error.message, result.status, result.error.reason)
          }
          const billing = readGroupBilling(result.data.billing)
          if (!billing) throw new ReadRefused(UNREADABLE, result.status)
          return billing
        },
        (copy) => {
          if (copy && current.value?.groupId === groupId) return false
          current.value = copy ? { groupId, billing: copy.value } : null
        },
      )
      current.value = { groupId, billing }
      if (error.value?.groupId === groupId) error.value = null
    } catch (cause) {
      const message = cause instanceof ReadRefused ? String(cause.failure) : OFFLINE
      error.value = { groupId, message, id: ++refusals }
    }
  }

  /** Asks the API for the provider's page; `unreachable` is said when the call never arrives. */
  async function open(
    groupId: string,
    action: string,
    unreachable: string,
    body?: unknown,
  ): Promise<void> {
    if (pending.value) return
    pending.value = true
    error.value = null
    // Once the provider's page is opening, the buttons stay disabled until the page is left.
    let leaving = false
    try {
      const result = await fetch<{ url: string }>(billingPath(groupId, action), {
        method: "POST",
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (!result.ok) {
        error.value = { groupId, message: result.error.message, id: ++refusals }
        return
      }
      const url = providerPageUrl(result.data.url)
      if (!url) {
        error.value = { groupId, message: UNSAFE_PAGE, id: ++refusals }
        return
      }
      leaving = true
      leave(url)
    } catch (_unreachable) {
      error.value = { groupId, message: unreachable, id: ++refusals }
    } finally {
      if (!leaving) pending.value = false
    }
  }

  /** Opens the provider's checkout for `planId`. */
  function checkout(groupId: string, planId: string): Promise<void> {
    return open(groupId, "/checkout", CHECKOUT_UNREACHABLE, { planId })
  }

  /** Opens the provider's portal, where the owner changes the card or plan, or cancels. */
  function portal(groupId: string): Promise<void> {
    return open(groupId, "/portal", PORTAL_UNREACHABLE)
  }

  /** The person's own trial, for the create-group page; `null` until read or when unreadable. */
  const trial = signal<PersonTrial | null>(null)

  /** Reads the person's trial. A failure leaves `trial` empty: the page then says nothing of it. */
  async function loadTrial(): Promise<void> {
    try {
      const result = await fetch<{ trial: unknown }>(`/api/billing/trial`)
      trial.value = result.ok ? readPersonTrial(result.data.trial) : null
    } catch (_unreachable) {
      trial.value = null
    }
  }

  function reset(): void {
    current.value = null
    error.value = null
    pending.value = false
    trial.value = null
  }

  return { current, error, pending, trial, load, loadTrial, checkout, portal, reset }
}

/** The app's billing store. */
export const billingStore = createBillingStore(apiFetch, undefined, localReads)
