import { signal } from "@preact/signals"
import { type DataExportJson, type DataExportView, parseDataExportJson } from "@domain/identity"
import type { DataExportError } from "@ui/profile-export.tsx"
import { apiFetch } from "./api.ts"

/** The API path of the person's data export (#229). */
export const DATA_EXPORT_PATH = "/api/account/data-export"

/** The address that downloads the ready file: the API answers with a short-lived signed link. */
export const DATA_EXPORT_DOWNLOAD_PATH = `${DATA_EXPORT_PATH}/download`

/** One call's outcome: the newest export, or the status and code of the refusal. */
export type DataExportCall =
  | { ok: true; export: DataExportView | null }
  | { ok: false; status: number; code?: string }

/** What the store calls. Injected so tests need no network. */
export interface DataExportDependencies {
  latest(): Promise<DataExportCall>
  request(): Promise<DataExportCall>
}

async function call(
  result: ReturnType<typeof apiFetch<{ export: DataExportJson | null }>>,
): Promise<DataExportCall> {
  const answer = await result
  if (!answer.ok) return { ok: false, status: answer.status, code: answer.error.reason }
  return { ok: true, export: answer.data.export ? parseDataExportJson(answer.data.export) : null }
}

/** The calls to `/api/account/data-export`, the session's own route. */
export const dataExportHttp: DataExportDependencies = {
  latest: () => call(apiFetch(DATA_EXPORT_PATH, {})),
  request: () => call(apiFetch(DATA_EXPORT_PATH, { method: "POST" })),
}

/**
 * The "Your data" row's state: the newest export (`undefined` until it is read), whether a request
 * is in flight, and why the last one was refused. A read that fails leaves the row as if the
 * person never asked: a request then answers the truth.
 */
export function createDataExportStore(dependencies: DataExportDependencies = dataExportHttp) {
  const current = signal<DataExportView | null | undefined>(undefined)
  const pending = signal(false)
  const error = signal<DataExportError | null>(null)

  async function load(): Promise<void> {
    const result = await dependencies.latest()
    current.value = result.ok ? result.export : (current.value ?? null)
  }

  async function request(): Promise<void> {
    if (pending.value) return
    pending.value = true
    error.value = null
    try {
      const result = await dependencies.request()
      if (result.ok) {
        current.value = result.export
      } else if (result.code === "TOO_SOON") {
        await load()
        const retryAt = current.value?.nextRequestAt ?? new Date(Date.now() + 86_400_000)
        error.value = { kind: "too-soon", retryAt }
      } else {
        error.value = { kind: "network" }
      }
    } catch {
      error.value = { kind: "network" }
    } finally {
      pending.value = false
    }
  }

  return { current, pending, error, load, request }
}

export type DataExportStore = ReturnType<typeof createDataExportStore>
