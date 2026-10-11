import { computed, signal } from "@preact/signals"
import { describeError, RealtimeRequestError } from "@spy4x/realtime"
import { DEFAULT_TAG_COLOR, TAG_NAME_MAX_LENGTH, type TagColor } from "@domain/tags"
import { apiAsUser } from "./realtime-call.ts"
import { callCommand, currentLayer, offlineTags } from "../modules.ts"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

/** A tag as the API sends it: dates are ISO strings, the sequence a decimal string. */
export interface TagItem {
  id: string
  groupId: string
  name: string
  color: TagColor
  version: number
  changeSequence: string
  createdByUserId: number | null
  updatedByUserId: number | null
  createdAt: string
  updatedAt: string
}

/** What the tags store needs from the outside. Injected so tests need no network. */
export interface TagsDependencies {
  /** Reads a group's tags, over REST: the same read at start-up and after a push. */
  fetchList(groupId: string): Promise<TagItem[]>
  create(input: { groupId: string; id: string; name: string; color: TagColor }): Promise<
    { tag: TagItem }
  >
  update(
    input: { groupId: string; id: string; name: string; color: TagColor; version: number },
  ): Promise<{ tag: TagItem }>
  delete(input: { groupId: string; id: string; version: number }): Promise<unknown>
  newId(): string
  /** What the device already holds of a group's tags, shown before the read answers. */
  readLocal?(groupId: string): Promise<readonly TagItem[]>
}

export const TAG_MESSAGES = {
  nameRequired: "Enter a name",
  nameTaken: "This group already has a tag with that name.",
  conflict: "Someone changed this tag since you opened it. It is shown as it is now.",
  gone: "This tag was deleted.",
  load: "Could not load the tags",
  create: "Could not add the tag",
  save: "Could not save the tag",
  delete: "Could not delete the tag",
} as const

/** The state of the tag form: the tag being created or edited, or none. */
export interface TagForm {
  /** `null` creates a tag; an id edits that tag. */
  id: string | null
  name: string
  color: TagColor
  version: number
}

/** The error text of a form: for the name, or for the whole form. */
export interface TagFormErrors {
  name: string | null
  form: string | null
}

const NO_ERRORS: TagFormErrors = { name: null, form: null }

/** The tag code of a refused call (`TAG_NAME_TAKEN`, `VERSION_CONFLICT`...), or `null`. */
function tagCode(error: unknown): string | null {
  if (!(error instanceof RealtimeRequestError)) return null
  const code = (error.details as { code?: unknown } | undefined)?.code
  return typeof code === "string" ? code : null
}

/**
 * The tags of one group: the list, and the one form (create or edit) the tags screen opens.
 * Notes read it for their picker, their chips and their filter, so it is a store of its own, and
 * it follows the notes' rules: a full read of the server's answer, with the device's copy and the
 * queued writes shown meanwhile.
 */
export function createTagsStore(dependencies: TagsDependencies) {
  const groupId = signal<string | null>(null)
  const tags = signal<readonly TagItem[]>([])
  const loading = signal(false)
  const listError = signal<string | null>(null)
  const form = signal<TagForm | null>(null)
  const formErrors = signal<TagFormErrors>(NO_ERRORS)
  const saving = signal(false)
  const deleting = signal<string | null>(null)
  /** The tag by id, for the chips a note shows. */
  const byId = computed(() => new Map(tags.value.map((tag) => [tag.id, tag])))
  let inFlight: Promise<void> | null = null
  let queued: Promise<void> | null = null

  function start(): Promise<void> {
    const forGroup = groupId.value
    if (!forGroup) return Promise.resolve()
    loading.value = true
    inFlight = dependencies.fetchList(forGroup).then((all) => {
      // The person may have opened another group while this read ran.
      if (groupId.value === forGroup) tags.value = all
    }).finally(() => {
      inFlight = null
      loading.value = false
    })
    return inFlight
  }

  /** Reads the open group's tags again; exactly one more read is queued behind a running one. */
  function refresh(): Promise<void> {
    if (!inFlight) return start()
    queued ??= inFlight.catch(() => {}).then(() => {
      queued = null
      return start()
    })
    return queued
  }

  /** Shows what the device holds while the read runs, unless the read answered first. */
  async function showLocal(forGroup: string): Promise<void> {
    const local = await dependencies.readLocal?.(forGroup).catch(() => undefined)
    if (local && groupId.value === forGroup && loading.value && tags.value.length === 0) {
      tags.value = local
    }
  }

  /** Shows a group's tags. Opening the group already open does nothing. */
  async function open(nextGroupId: string): Promise<void> {
    if (groupId.value === nextGroupId) return
    reset()
    groupId.value = nextGroupId
    void showLocal(nextGroupId)
    listError.value = null
    try {
      await refresh()
    } catch (cause) {
      listError.value = describeError(cause, TAG_MESSAGES.load)
    }
  }

  /** Opens the form to create a tag. */
  function startCreate(): void {
    form.value = { id: null, name: "", color: DEFAULT_TAG_COLOR, version: 0 }
    formErrors.value = NO_ERRORS
  }

  /** Opens the form to rename or recolour a tag. */
  function startEdit(id: string): void {
    const tag = byId.value.get(id)
    if (!tag) return
    form.value = { id, name: tag.name, color: tag.color, version: tag.version }
    formErrors.value = NO_ERRORS
  }

  function change(next: TagForm): void {
    form.value = next
  }

  function closeForm(): void {
    form.value = null
    formErrors.value = NO_ERRORS
  }

  /** Saves the form: creates or updates. Resolves `true` once saved. */
  async function save(): Promise<boolean> {
    const forGroup = groupId.value
    const current = form.value
    if (!forGroup || !current || saving.value) return false
    const name = current.name.trim()
    if (!name) {
      formErrors.value = { name: TAG_MESSAGES.nameRequired, form: null }
      return false
    }
    saving.value = true
    formErrors.value = NO_ERRORS
    try {
      const { tag } = current.id === null
        ? await dependencies.create({
          groupId: forGroup,
          id: dependencies.newId(),
          name: name.slice(0, TAG_NAME_MAX_LENGTH),
          color: current.color,
        })
        : await dependencies.update({
          groupId: forGroup,
          id: current.id,
          name: name.slice(0, TAG_NAME_MAX_LENGTH),
          color: current.color,
          version: current.version,
        })
      tags.value = sorted([tag, ...tags.value.filter((existing) => existing.id !== tag.id)])
      form.value = null
      return true
    } catch (cause) {
      const code = tagCode(cause)
      if (code === "TAG_NAME_TAKEN") {
        formErrors.value = { name: TAG_MESSAGES.nameTaken, form: null }
      } else if (code === "VERSION_CONFLICT" || code === "TAG_NOT_FOUND") {
        // The form would save over the other change: read the latest and close it. The message
        // goes above the list, because the form that would show it is closed.
        form.value = null
        await refresh().catch(() => {})
        listError.value = code === "TAG_NOT_FOUND" ? TAG_MESSAGES.gone : TAG_MESSAGES.conflict
      } else {
        formErrors.value = {
          name: null,
          form: describeError(cause, current.id === null ? TAG_MESSAGES.create : TAG_MESSAGES.save),
        }
      }
      return false
    } finally {
      saving.value = false
    }
  }

  /** Deletes a tag at the version the person saw. Its notes keep everything else. */
  async function remove(id: string): Promise<boolean> {
    const forGroup = groupId.value
    const tag = byId.value.get(id)
    if (!forGroup || !tag || deleting.value) return false
    deleting.value = id
    listError.value = null
    try {
      await dependencies.delete({ groupId: forGroup, id, version: tag.version })
      tags.value = tags.value.filter((existing) => existing.id !== id)
      return true
    } catch (cause) {
      const code = tagCode(cause)
      listError.value = code === "VERSION_CONFLICT"
        ? TAG_MESSAGES.conflict
        : code === "TAG_NOT_FOUND"
        ? TAG_MESSAGES.gone
        : describeError(cause, TAG_MESSAGES.delete)
      if (code === "VERSION_CONFLICT" || code === "TAG_NOT_FOUND") await refresh().catch(() => {})
      return false
    } finally {
      deleting.value = null
    }
  }

  function reset(): void {
    groupId.value = null
    tags.value = []
    loading.value = false
    listError.value = null
    form.value = null
    formErrors.value = NO_ERRORS
    saving.value = false
    deleting.value = null
    inFlight = null
    queued = null
  }

  return {
    groupId,
    tags,
    byId,
    loading,
    listError,
    form,
    formErrors,
    saving,
    deleting,
    open,
    refresh,
    startCreate,
    startEdit,
    change,
    closeForm,
    save,
    remove,
    reset,
  }
}

function sorted(all: TagItem[]): TagItem[] {
  return all.sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.id.localeCompare(b.id)
  )
}

/** The tags as the server serves them: reads over REST, writes through the calls port. */
export const onlineTags: TagsDependencies = {
  async fetchList(groupId) {
    const result = await apiAsUser<{ tags: TagItem[] }>(`/api/groups/${groupId}/tags`)
    if (!result.ok) throw new Error(result.error.message)
    return result.data.tags
  },
  create: (input) => callCommand("tag.create", input),
  update: (input) => callCommand("tag.update", input),
  delete: (input) => callCommand("tag.delete", input),
  newId: () => uuidV7(),
}

/** The page's own store: with the offline layer running, served from the device and queued offline. */
export const tagsStore = createTagsStore(offlineTags(onlineTags, currentLayer))
