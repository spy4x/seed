import { signal } from "@preact/signals"
import { readPlanRefusal } from "@domain/billing"
import { type ApiErrorAnswer, readApiError } from "@domain/errors"
import {
  GROUP_IMPORT_MAX_BYTES,
  type GroupImportProblem,
  type GroupImportResult,
  type GroupImportSummary,
} from "@domain/groups"
import type { GroupImportState } from "@ui/group-import-screen.tsx"
import { downloadResponseAsFile } from "@spy4x/platform/browser/download"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { fetchAsUser } from "./realtime-call.ts"

/** What the export and import stores need from the platform; tests pass fakes. */
export interface GroupFilePorts {
  /**
   * Sends a request; the store names the page's user on it, as every REST request does. Left out,
   * {@link fetchAsUser} sends it with the browser's own.
   */
  fetch?: (url: string, init?: RequestInit) => Promise<Response>
  /** Saves the response body as a file on the device. */
  save: (response: Response, filename: string) => Promise<void>
}

const browserPorts: GroupFilePorts = {
  save: (response, filename) => downloadResponseAsFile(response, filename),
}

/** The file name the server gave in `Content-Disposition`, or a plain one. */
function fileNameOf(response: Response): string {
  const header = response.headers.get("content-disposition") ?? ""
  return /filename="([^"]+)"/.exec(header)?.[1] ?? "group-export.json"
}

/** Reads a JSON body, or `null` when there is none. */
async function bodyOf(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

/**
 * Downloading a group's export file. One export at a time; the group page shows "Preparing…"
 * while it runs and a notice when it failed.
 */
export function createGroupExportStore(ports: GroupFilePorts = browserPorts) {
  /** The group whose file is being prepared, or `null`. */
  const exporting = signal<string | null>(null)
  /** The group whose last export failed, or `null`. */
  const failed = signal<string | null>(null)

  /** Downloads the file; resolves to whether it was saved. */
  async function download(groupId: string): Promise<boolean> {
    if (exporting.value !== null) return false
    exporting.value = groupId
    failed.value = null
    try {
      const response = await fetchAsUser(
        `/api/groups/${encodeURIComponent(groupId)}/export`,
        undefined,
        ports.fetch,
      )
      if (!response.ok) throw new Error(`Export answered ${response.status}`)
      await ports.save(response, fileNameOf(response))
      return true
    } catch {
      failed.value = groupId
      return false
    } finally {
      exporting.value = null
    }
  }

  return { exporting, failed, download, forget: () => (failed.value = null) }
}

/**
 * The import page: the chosen file, the server's check of it, the new group's name and the import.
 * A check or an import the page no longer waits for (the person chose another file) is ignored when
 * it answers.
 */
export function createGroupImportStore(ports: GroupFilePorts = browserPorts) {
  const state = signal<GroupImportState>({ step: "choose" })
  const name = signal("")
  const nameError = signal<string | null>(null)
  const importing = signal(false)
  const importFailed = signal(false)
  /** Counts the page's fresh starts, so the picker forgets its file. */
  const attempt = signal(0)
  let file: { text: string } | null = null
  let ticket = 0
  /** One key per checked file, so a retried import that already landed creates no second group. */
  let idempotencyKey = ""

  function refusal(error: ApiErrorAnswer | null): GroupImportState | null {
    const details = error?.details as { problems?: unknown; total?: unknown } | undefined
    if (error?.reason === "IMPORT_REFUSED" && Array.isArray(details?.problems)) {
      const problems = details.problems as GroupImportProblem[]
      return { step: "refused", problems, total: Number(details.total ?? problems.length) }
    }
    const plan = readPlanRefusal(error?.details)
    if (plan) return { step: "plan", refusal: plan, notes: 0 }
    return null
  }

  async function check(): Promise<void> {
    const mine = ++ticket
    if (file === null) return
    state.value = { step: "checking" }
    try {
      const response = await fetchAsUser("/api/groups/import/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: file.text,
      }, ports.fetch)
      const body = await bodyOf(response)
      if (mine !== ticket) return
      if (response.ok) {
        const summary = body as unknown as GroupImportSummary
        name.value = summary.name
        nameError.value = null
        importFailed.value = false
        idempotencyKey = uuidV7()
        state.value = { step: "checked", summary }
        return
      }
      const refused = refusal(readApiError(body))
      if (refused?.step === "plan") {
        // The plan's refusal names the cap; the page says how many notes the file has too.
        refused.notes = countNotes(file.text)
      }
      state.value = refused ?? { step: "unchecked" }
    } catch {
      if (mine === ticket) state.value = { step: "unchecked" }
    }
  }

  /** The person chose a file, or removed it (`null`). */
  async function choose(chosen: File | null): Promise<void> {
    ticket++
    file = null
    if (chosen === null) {
      state.value = { step: "choose" }
      return
    }
    if (chosen.size > GROUP_IMPORT_MAX_BYTES) {
      state.value = {
        step: "refused",
        problems: [{ kind: "too_large", maxBytes: GROUP_IMPORT_MAX_BYTES }],
        total: 1,
      }
      return
    }
    const mine = ticket
    const text = await chosen.text()
    if (mine !== ticket) return
    file = { text }
    await check()
  }

  /** Creates the group; resolves to it, or `null` when the import was refused or failed. */
  async function importNow(): Promise<GroupImportResult | null> {
    if (file === null || importing.value || state.value.step !== "checked") return null
    importing.value = true
    importFailed.value = false
    nameError.value = null
    try {
      const response = await fetchAsUser("/api/groups/import", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        // The file went through the check as it is, so it is JSON and goes in unchanged.
        body: `{"name":${JSON.stringify(name.value)},"file":${file.text}}`,
      }, ports.fetch)
      const body = await bodyOf(response)
      if (response.ok) return body as unknown as GroupImportResult
      const error = readApiError(body)
      if (error?.reason === "INVALID_REQUEST") {
        nameError.value = "Give the group a name of 1 to 100 characters."
        return null
      }
      const refused = refusal(error)
      if (refused) state.value = refused
      else importFailed.value = true
      return null
    } catch {
      importFailed.value = true
      return null
    } finally {
      importing.value = false
    }
  }

  /** Starts over with no file, as "Choose another file" and leaving the page do. */
  function reset(): void {
    ticket++
    file = null
    state.value = { step: "choose" }
    name.value = ""
    nameError.value = null
    importFailed.value = false
    attempt.value++
  }

  return {
    state,
    name,
    nameError,
    importing,
    importFailed,
    attempt,
    choose,
    retry: check,
    importNow,
    reset,
  }
}

/** How many notes a file holds, read only to word a plan refusal; `0` when it cannot tell. */
function countNotes(text: string): number {
  try {
    const notes = JSON.parse(text)?.aggregates?.notes
    return Array.isArray(notes) ? notes.length : 0
  } catch {
    return 0
  }
}

export const groupExportStore = createGroupExportStore()
export const groupImportStore = createGroupImportStore()
