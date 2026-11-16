import { signal } from "@preact/signals"
import type { ColumnMap } from "@spy4x/preact-ui/import-mapper"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import {
  type ImportCheckResult,
  type ImportChoices,
  type ImportMapping,
  ImportStatus,
  type ImportSummary,
} from "@domain/imports"
import { GUEST_REFUSAL_CODE } from "@domain/identity"
import { apiFetch } from "./api.ts"
import { appText } from "../i18n.ts"

/** How long after a column change the check runs, so a run of changes costs one check. */
export const IMPORT_CHECK_DELAY_MS = 400

/** One call's outcome: the data, or the refusal. `status` 0 means no answer: the network. */
export type ImportsResult<T> = { ok: true; data: T } | {
  ok: false
  status: number
  /** The API's message, already in the person's language; empty without an answer. */
  error: string
  /** The API's error code, such as `ROLE_INSUFFICIENT`. */
  code?: string
}

/** What the person answered to a review, as a save sends it: both left out when empty. */
export interface ImportReviewAnswer {
  choices?: ImportChoices
  keep?: number[]
}

/** The calls to `/api/groups/:groupId/imports`. Injected so tests need no network. */
export interface ImportsTransport {
  upload(
    groupId: string,
    kind: string,
    file: File,
    key: string,
    options?: Record<string, string>,
  ): Promise<ImportsResult<ImportSummary>>
  list(groupId: string): Promise<ImportsResult<{ imports: ImportSummary[] }>>
  get(groupId: string, importId: string): Promise<ImportsResult<ImportSummary>>
  check(
    groupId: string,
    importId: string,
    mapping: ImportMapping,
  ): Promise<ImportsResult<ImportCheckResult>>
  commit(
    groupId: string,
    importId: string,
    mapping: ImportMapping,
    key: string,
    review?: ImportReviewAnswer,
  ): Promise<ImportsResult<ImportSummary>>
  undo(groupId: string, importId: string, key: string): Promise<ImportsResult<ImportSummary>>
}

/** The timer the check waits on. Injected so tests run without waiting. */
export interface ImportsTimer {
  set(run: () => void, ms: number): number
  clear(handle: number): void
}

const base = (groupId: string) => `/api/groups/${encodeURIComponent(groupId)}/imports`
const one = (groupId: string, importId: string) =>
  `${base(groupId)}/${encodeURIComponent(importId)}`

/** A call through the SPA's `apiFetch`, with a network failure as status 0 instead of a throw. */
async function call<T>(path: string, init: RequestInit): Promise<ImportsResult<T>> {
  try {
    const result = await apiFetch<T>(path, init)
    return result.ok
      ? { ok: true, data: result.data }
      : { ok: false, status: result.status, error: result.error.message, code: result.error.reason }
  } catch {
    return { ok: false, status: 0, error: `` }
  }
}

const post = (body: unknown, key?: string): RequestInit => ({
  method: `POST`,
  body: JSON.stringify(body),
  headers: key ? { "idempotency-key": key } : undefined,
})

/** An upload's query: the kind, the file's name and, when given, the options as JSON. */
function uploadQuery(
  kind: string,
  name: string,
  options?: Record<string, string>,
): URLSearchParams {
  const query = new URLSearchParams({ kind, name })
  if (options) query.set(`options`, JSON.stringify(options))
  return query
}

/** The calls the SPA makes, through `apiFetch`. */
export const importsHttp: ImportsTransport = {
  upload: (groupId, kind, file, key, options) =>
    call(`${base(groupId)}?${uploadQuery(kind, file.name, options)}`, {
      method: `POST`,
      // The file goes as it is; the server reads its bytes and guesses its encoding.
      body: file,
      headers: { "idempotency-key": key },
    }),
  list: (groupId) => call(base(groupId), {}),
  get: (groupId, importId) => call(one(groupId, importId), {}),
  check: (groupId, importId, mapping) => call(`${one(groupId, importId)}/check`, post({ mapping })),
  commit: (groupId, importId, mapping, key, review) =>
    call(`${one(groupId, importId)}/commit`, post({ mapping, ...review }, key)),
  undo: (groupId, importId, key) => call(`${one(groupId, importId)}/undo`, post({}, key)),
}

const browserTimer: ImportsTimer = {
  // `Number`: Node types the handle as an object, which turns into its id; the browser gives the id.
  set: (run, ms) => Number(setTimeout(run, ms)),
  clear: (handle) => clearTimeout(handle),
}

/** The mapping the API takes: only the fields set to a column. */
function sent(mapping: ColumnMap): ImportMapping {
  const out: ImportMapping = {}
  for (const [key, column] of Object.entries(mapping)) if (column !== null) out[key] = column
  return out
}

/** The mapper's map of a read import: every field, on its saved or guessed column or on none. */
function mappingOf(summary: ImportSummary): ColumnMap {
  const saved = summary.preview?.mapping ?? {}
  return Object.fromEntries(summary.fields.map((field) => [field.key, saved[field.key] ?? null]))
}

/**
 * The import pages' state: the recent list and the upload for the picker, and the one import that
 * is open, its mapping, its check and its save and undo. One store for the app, so the change feed
 * can re-read the open import when a hint for its group arrives ({@link refresh}); `groupId` is
 * that group while an import is open.
 *
 * Answers the page no longer waits for (another import opened, a newer check sent) are dropped.
 * A save or undo that got no answer keeps its idempotency key, so pressing again cannot act twice.
 */
export function createImportsStore(
  transport: ImportsTransport = importsHttp,
  timer: ImportsTimer = browserTimer,
) {
  const groupId = signal<string | null>(null)
  const recent = signal<readonly ImportSummary[] | null>(null)
  const uploading = signal<string | null>(null)
  const uploadError = signal<string | null>(null)
  const current = signal<ImportSummary | null>(null)
  const gone = signal(false)
  const forbidden = signal(false)
  const mapping = signal<ColumnMap>({})
  const check = signal<ImportCheckResult | null>(null)
  const checking = signal(false)
  const committing = signal(false)
  const undoing = signal(false)
  const error = signal<string | null>(null)
  /** The picker's upload options as the person set them; `null` for the kind's initial ones. */
  const options = signal<Record<string, string> | null>(null)
  /** The person's values for the review's choice fields, only those that differ from it. */
  const choices = signal<ImportChoices>({})
  /** Rows to save despite an overridable skip. */
  const keep = signal<readonly number[]>([])
  let openId: string | null = null
  /** Bumped by every open and close, so a late answer for another import is dropped. */
  let opened = 0
  let checks = 0
  let pendingCheck: number | null = null
  const keys = {
    upload: null as string | null,
    commit: null as string | null,
    undo: null as string | null,
  }

  /** Shows `summary`; a newly read import gets its saved or guessed mapping and its first check. */
  function show(summary: ImportSummary): void {
    const before = current.value
    current.value = summary
    gone.value = false
    if (
      summary.status === ImportStatus.READY &&
      (before?.id !== summary.id || before.status !== ImportStatus.READY)
    ) {
      mapping.value = mappingOf(summary)
      void runCheck()
    }
  }

  /** What a refused save, undo or read does to the page. */
  function refused(result: Extract<ImportsResult<unknown>, { ok: false }>): void {
    if (result.status === 409) {
      // Someone changed it first, in another tab or a job: read it again and show that.
      void read()
      return
    }
    if (result.status === 404) {
      gone.value = true
      return
    }
    if (result.status === 403 && result.code === `ROLE_INSUFFICIENT`) {
      forbidden.value = true
      return
    }
    error.value = result.status === 0 || !result.error ? appText(`Import.failed`) : result.error
  }

  async function read(): Promise<void> {
    const group = groupId.value
    const id = openId
    if (group === null || id === null) return
    const mine = opened
    const result = await transport.get(group, id)
    if (mine !== opened) return
    if (result.ok) show(result.data)
    else if (result.status === 404) gone.value = true
  }

  async function runCheck(): Promise<void> {
    const group = groupId.value
    const id = openId
    if (group === null || id === null) return
    const mine = ++checks
    checking.value = true
    const result = await transport.check(group, id, sent(mapping.value))
    if (mine !== checks) return
    checking.value = false
    if (result.ok) check.value = result.data
    else if (result.status === 409 || result.status === 404) refused(result)
  }

  function cancelCheck(): void {
    if (pendingCheck !== null) timer.clear(pendingCheck)
    pendingCheck = null
  }

  return {
    groupId,
    recent,
    uploading,
    uploadError,
    current,
    gone,
    forbidden,
    mapping,
    check,
    checking,
    committing,
    undoing,
    error,
    options,
    choices,
    keep,

    /** Reads the person's recent imports in `group`, newest first. */
    async loadRecent(group: string): Promise<void> {
      const result = await transport.list(group)
      if (result.ok) recent.value = result.data.imports
      else if (result.status === 403 && result.code === `ROLE_INSUFFICIENT`) forbidden.value = true
    },

    /** Clears what the picker showed, as it opens. */
    startNew(): void {
      uploadError.value = null
      forbidden.value = false
      recent.value = null
      options.value = null
    },

    /** Sets the kind's upload options as the person filled them in. */
    setOptions(value: Record<string, string>): void {
      options.value = value
    },

    /**
     * Uploads `file` as a `kind` import into `group`, with the kind's `options` when it has them.
     * Resolves to the new import's id, or `null` with `uploadError` set; a guest's refusal is the
     * app frame's to say, so it sets nothing here.
     */
    async upload(
      group: string,
      kind: string,
      file: File,
      sentOptions?: Record<string, string>,
    ): Promise<string | null> {
      if (uploading.value !== null) return null
      uploading.value = file.name
      uploadError.value = null
      keys.upload ??= uuidV7()
      const result = await transport.upload(group, kind, file, keys.upload, sentOptions)
      uploading.value = null
      if (result.ok) {
        keys.upload = null
        return result.data.id
      }
      if (result.status !== 0) keys.upload = null
      if (result.code === GUEST_REFUSAL_CODE) return null
      if (result.status === 403 && result.code === `ROLE_INSUFFICIENT`) forbidden.value = true
      else if (result.status === 0) uploadError.value = appText(`Import.uploadFailed`)
      else uploadError.value = result.error
      return null
    },

    /** Opens import `id` of `group` and reads it. */
    async open(group: string, id: string): Promise<void> {
      opened++
      cancelCheck()
      checks++
      groupId.value = group
      openId = id
      current.value = null
      gone.value = false
      forbidden.value = false
      mapping.value = {}
      check.value = null
      checking.value = false
      committing.value = false
      undoing.value = false
      error.value = null
      choices.value = {}
      keep.value = []
      keys.commit = null
      keys.undo = null
      await read()
    },

    /** Reads the open import again: a hint for its group arrived, or the page came back online. */
    refresh: read,

    /** Sets one field's column; the check runs {@link IMPORT_CHECK_DELAY_MS} after the last one. */
    map(key: string, column: number | null): void {
      mapping.value = { ...mapping.value, [key]: column }
      error.value = null
      cancelCheck()
      pendingCheck = timer.set(() => {
        pendingCheck = null
        void runCheck()
      }, IMPORT_CHECK_DELAY_MS)
    },

    /**
     * Sets the person's value of choice field `field` on `row`. A value equal to the review's
     * suggestion is no choice at all, so it is dropped rather than sent.
     */
    choose(row: number, field: string, value: string): void {
      const suggestion = check.value?.reviews?.find((review) => review.row === row)
        ?.suggestions[field] ?? ``
      const { [String(row)]: before = {}, ...others } = choices.value
      const { [field]: _, ...rest } = before
      const after = value === suggestion ? rest : { ...rest, [field]: value }
      choices.value = Object.keys(after).length > 0 ? { ...others, [row]: after } : others
    },

    /** Saves `row` despite its overridable skip (`on`), or leaves it skipped again. */
    setKeep(row: number, on: boolean): void {
      const others = keep.value.filter((kept) => kept !== row)
      keep.value = on ? [...others, row] : others
    },

    /** Saves the rows with the mapping, the choices and the kept rows; then shows it saving. */
    async commit(): Promise<void> {
      const group = groupId.value
      const id = openId
      if (group === null || id === null || committing.value) return
      cancelCheck()
      const mine = opened
      committing.value = true
      error.value = null
      keys.commit ??= uuidV7()
      const answer: ImportReviewAnswer = {}
      if (Object.keys(choices.value).length > 0) answer.choices = choices.value
      if (keep.value.length > 0) answer.keep = [...keep.value]
      const result = await transport.commit(
        group,
        id,
        sent(mapping.value),
        keys.commit,
        answer.choices || answer.keep ? answer : undefined,
      )
      if (mine !== opened) return
      committing.value = false
      if (result.ok || result.status !== 0) keys.commit = null
      if (result.ok) show(result.data)
      else refused(result)
    },

    /** Undoes the saved batch. */
    async undo(): Promise<void> {
      const group = groupId.value
      const id = openId
      if (group === null || id === null || undoing.value) return
      const mine = opened
      undoing.value = true
      error.value = null
      keys.undo ??= uuidV7()
      const result = await transport.undo(group, id, keys.undo)
      if (mine !== opened) return
      undoing.value = false
      if (result.ok || result.status !== 0) keys.undo = null
      if (result.ok) show(result.data)
      else refused(result)
    },

    /** Leaves the import page: nothing more is read for it. */
    close(): void {
      opened++
      checks++
      cancelCheck()
      openId = null
      groupId.value = null
    },

    /** Forgets everything, at sign-out, so the next person sees nothing of this one's imports. */
    reset(): void {
      this.close()
      this.startNew()
      current.value = null
      gone.value = false
      mapping.value = {}
      check.value = null
      error.value = null
      choices.value = {}
      keep.value = []
      keys.upload = null
      keys.commit = null
      keys.undo = null
    },
  }
}

/** The app's one imports store. */
export const importsStore = createImportsStore()
