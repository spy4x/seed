import { signal } from "@preact/signals"
import type { TelegramLinkCodeResponse, TelegramStatusResponse } from "@domain/identity"
import { TELEGRAM_FAILURES } from "@ui/profile-telegram.tsx"
import { apiFetch } from "./api.ts"

/** An answer that worked, with what it carried, or one that did not, with the server's reason. */
type Answer<T> = { ok: true; data: T } | { ok: false; error: string }

/** The calls the Telegram row makes. The store takes them, so a test passes its own. */
export interface TelegramHttp {
  status(): Promise<Answer<TelegramStatusResponse>>
  code(): Promise<Answer<TelegramLinkCodeResponse>>
  unlink(): Promise<Answer<{ unlinked: boolean }>>
}

async function call<T>(path: string, init?: RequestInit): Promise<Answer<T>> {
  try {
    const result = await apiFetch<T>(path, init)
    return result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error.message }
  } catch {
    return { ok: false, error: `` }
  }
}

export const telegramHttp: TelegramHttp = {
  status: () => call(`/api/telegram`),
  code: () => call(`/api/telegram/code`, { method: `POST` }),
  unlink: () => call(`/api/telegram`, { method: `DELETE` }),
}

/** How often the open code dialog asks whether the bot has linked the account yet. */
export const TELEGRAM_WAIT_MS = 3_000

/** Waits `ms`; a test passes one that resolves at once. */
export type Sleep = (ms: number) => Promise<void>

/**
 * The profile's Telegram row (#269): the status, a link code and its dialog, and unlinking. While
 * the dialog is open the store reads the status every {@link TELEGRAM_WAIT_MS} until the bot has
 * linked the account, the code has expired or the dialog is closed; it then closes the dialog and
 * calls `onLinked`.
 */
export function createTelegramStore(
  http: TelegramHttp = telegramHttp,
  options: { sleep?: Sleep; now?: () => number; onLinked?: () => void } = {},
) {
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const now = options.now ?? Date.now
  /** `null` until the first read answers. */
  const status = signal<TelegramStatusResponse | null>(null)
  const code = signal<TelegramLinkCodeResponse | null>(null)
  const error = signal<string | null>(null)
  const pending = signal(false)
  /** Grows with every dialog opened or closed, so a wait for an older one stops. */
  let waiting = 0

  async function load(): Promise<void> {
    const answer = await http.status()
    if (answer.ok) {
      status.value = answer.data
      error.value = null
    } else {
      error.value = answer.error || TELEGRAM_FAILURES.status
    }
  }

  /** Reads the status until the account is linked, the code expires or the dialog closes. */
  async function wait(turn: number, expiresAt: number): Promise<void> {
    while (turn === waiting && now() < expiresAt) {
      await sleep(TELEGRAM_WAIT_MS)
      if (turn !== waiting) return
      const answer = await http.status()
      if (turn !== waiting) return
      if (answer.ok && answer.data.linkedAt) {
        status.value = answer.data
        closeCode()
        options.onLinked?.()
        return
      }
    }
  }

  async function link(): Promise<void> {
    pending.value = true
    error.value = null
    const answer = await http.code()
    pending.value = false
    if (!answer.ok) {
      error.value = answer.error || TELEGRAM_FAILURES.code
      return
    }
    code.value = answer.data
    void wait(++waiting, Date.parse(answer.data.expiresAt))
  }

  function closeCode(): void {
    waiting++
    code.value = null
  }

  async function unlink(): Promise<void> {
    pending.value = true
    error.value = null
    const answer = await http.unlink()
    pending.value = false
    if (!answer.ok) {
      error.value = answer.error || TELEGRAM_FAILURES.unlink
      return
    }
    if (status.value) status.value = { ...status.value, linkedAt: null }
  }

  return { status, code, error, pending, load, link, closeCode, unlink }
}

export type TelegramStore = ReturnType<typeof createTelegramStore>
