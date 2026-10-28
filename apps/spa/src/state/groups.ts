import { signal } from "@preact/signals"
import { describeError, RealtimeRequestError } from "@spy4x/realtime"
import {
  GROUP_DESCRIPTION_MAX,
  type GroupColor,
  type GroupDetails,
  GroupError,
  type GroupMoveAllResult,
  type GroupRole,
  parseGroupDescription,
  parseGroupEmoji,
  parseGroupName,
} from "@domain/groups"
import { type PlanRefusal, readPlanRefusal } from "@domain/billing"
import { apiAsUser } from "./realtime-call.ts"
import { READ_KEYS } from "./read-keys.ts"
import { ReadRefused } from "@spy4x/realtime/read-cache"
import {
  advanceGroupCursor,
  callCommand,
  callQuery,
  type LocalReads,
  localReads,
} from "../modules.ts"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import {
  EMPTY_GROUP_DRAFT,
  type GroupDraft,
  type GroupEditorErrors,
} from "@ui/group-editor-screen.tsx"
import { appText } from "../i18n.ts"

/** A group as the API sends it: dates are ISO strings, the sequence a decimal string. */
export interface GroupItem {
  id: string
  name: string
  /** Absent in a list stored on the device before groups had details; read as empty. */
  description?: string
  color?: GroupColor | null
  emoji?: string | null
  role: GroupRole
  authorizationRevision: string
  changeSequence: string
  updatedAt: string
  /** How many members the group has; only the list sends it. */
  memberCount?: number
  /** The first few members, for the card's avatar stack; only the list sends them. */
  members?: { name: string }[]
}

/** A deleted group its owner can still restore; `deletedAt` is an ISO string. */
export interface DeletedGroupItem extends GroupItem {
  deletedAt: string
}

/** One page of the API's group list. */
export interface GroupPage {
  groups: GroupItem[]
  nextCursor: string | null
}

/** What the groups store needs from the outside. Injected so tests need no network. */
export interface GroupsDependencies {
  /** Reads one page of the person's groups, over REST or as the socket's `group.list` query. */
  fetchPage(cursor: string | null, via: ReadChannel): Promise<GroupPage>
  /** Reads the groups the person deleted and can still restore. */
  fetchDeleted(via: ReadChannel): Promise<{ groups: DeletedGroupItem[] }>
  /** Creates a group with its details, in one request, and returns it. */
  create(input: { id: string; name: string } & GroupDetails): Promise<{ group: GroupItem }>
  rename(input: { groupId: string; name: string }): Promise<{ group: GroupItem }>
  /** Sets a group's description, colour and emoji. */
  updateDetails(input: GroupDetails & { groupId: string }): Promise<{ group: GroupItem }>
  /** Deletes a group, softly: its owner can restore it for 30 days. */
  remove(input: { groupId: string }): Promise<{ group: DeletedGroupItem }>
  restore(input: { groupId: string }): Promise<{ group: GroupItem }>
  /** Moves every live note of a group to another group, all or nothing. */
  moveAll(input: { groupId: string; toGroupId: string }): Promise<GroupMoveAllResult>
  /** Records that this page holds a group up to a sequence. */
  advance(groupId: string, sequence: number): void
  newId(): string
  /** What the device already holds of the list, shown before the read answers. */
  readLocal?(): Promise<readonly GroupItem[]>
}

/** The changes to an existing group the store can make. */
export type GroupAction = "save" | "delete" | "restore" | "moveAll"

export { EMPTY_GROUP_DRAFT, type GroupDraft, type GroupEditorErrors }

/** The keys of the editor's own messages in the `app` catalog; {@link appText} reads them. */
export const GROUP_MESSAGES = {
  nameRequired: `GroupEditor.nameRequired`,
  nameInvalid: `GroupEditor.nameInvalid`,
  descriptionTooLong: `GroupEditor.descriptionTooLong`,
  emojiInvalid: `GroupEditor.emojiInvalid`,
  create: `GroupEditor.createFailed`,
  createOffline: `GroupEditor.createOffline`,
  saveOffline: `GroupEditor.saveOffline`,
} as const

/** The editor's fields for a saved group. */
export function draftOf(group: GroupItem): GroupDraft {
  return {
    name: group.name,
    description: group.description ?? "",
    color: group.color ?? null,
    emoji: group.emoji ?? "",
  }
}

/** Whether two drafts would save the same group: spaces around the text do not count. */
function sameDraft(a: GroupDraft, b: GroupDraft): boolean {
  return a.name.trim() === b.name.trim() && a.description.trim() === b.description.trim() &&
    a.color === b.color && a.emoji.trim() === b.emoji.trim()
}

/** Reads `parse`'s answer, or `null` when it refused the value. */
function parsed<T>(parse: () => T): { value: T } | null {
  try {
    return { value: parse() }
  } catch (cause) {
    if (cause instanceof GroupError) return null
    throw cause
  }
}

/**
 * Checks a draft with the server's own parsers, so a typo is told before a round trip. Gives the
 * name and details to send, or the message for each field that is wrong.
 */
export function checkGroupDraft(
  draft: GroupDraft,
): { ok: true; name: string; details: GroupDetails } | { ok: false; errors: GroupEditorErrors } {
  const name = parsed(() => parseGroupName(draft.name))
  const description = parsed(() => parseGroupDescription(draft.description))
  const emoji = parsed(() => parseGroupEmoji(draft.emoji))
  if (name && description && emoji) {
    return {
      ok: true,
      name: name.value,
      details: { description: description.value, color: draft.color, emoji: emoji.value },
    }
  }
  return {
    ok: false,
    errors: {
      name: name
        ? null
        : draft.name.trim() === ""
        ? appText(GROUP_MESSAGES.nameRequired)
        : appText(GROUP_MESSAGES.nameInvalid),
      description: description
        ? null
        : appText(GROUP_MESSAGES.descriptionTooLong, { count: GROUP_DESCRIPTION_MAX }),
      emoji: emoji ? null : appText(GROUP_MESSAGES.emojiInvalid),
    },
  }
}

/** How a read reaches the API. */
export type ReadChannel = "rest" | "socket"

const PAGE_LIMIT = 100
/** More pages than any account has groups: a stop for a cursor loop, not a limit people meet. */
const MAX_PAGES = 100

/**
 * The groups screen's state: the list, the create form and what is in flight.
 *
 * The list is always a full read of the server's answer, so a read after a missed push and a read
 * at start-up are the same code, and the list cannot drift from the server.
 */
export function createGroupsStore(dependencies: GroupsDependencies) {
  const groups = signal<readonly GroupItem[]>([])
  const deleted = signal<readonly DeletedGroupItem[]>([])
  /**
   * What the person typed in the group editor, with the group it is for (`null`: a new group).
   * `null` while nothing was typed: the editor then shows the group as saved, also when the group
   * is read after the page opened.
   */
  const editor = signal<{ groupId: string | null; value: GroupDraft } | null>(null)
  /** Why the editor's last create or save was refused. */
  const editorErrors = signal<GroupEditorErrors>({})
  /** The group a save, delete or restore is in flight for, and which of them. */
  const working = signal<{ groupId: string; action: GroupAction } | null>(null)
  /** Why the last save, delete or restore was refused. */
  const actionError = signal<
    { groupId: string; action: GroupAction; message: string; plan?: PlanRefusal } | null
  >(null)
  /**
   * The last move of a group's data that worked, until the person closes its dialog: how many
   * notes and how many tags went.
   */
  const moved = signal<
    { groupId: string; toGroupId: string; count: number; tags: number } | null
  >(null)
  /**
   * True from the start, and again after a reset, until a read has answered: an empty list that
   * has not been read is not "no groups".
   */
  const loading = signal(true)
  const creating = signal(false)
  const error = signal<string | null>(null)
  /** The last list read failed; cleared by the next read that succeeds. */
  const loadError = signal<string | null>(null)
  let inFlight: Promise<void> | null = null
  let queued: Promise<void> | null = null

  async function readAll(via: ReadChannel): Promise<void> {
    const all: GroupItem[] = []
    let cursor: string | null = null
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await dependencies.fetchPage(cursor, via)
      all.push(...result.groups)
      cursor = result.nextCursor
      if (cursor === null) break
    }
    groups.value = all
    for (const group of all) dependencies.advance(group.id, Number(group.changeSequence))
    // The restore list is a second read of the same moment. Without a network it keeps what it
    // had: the groups above are what the page cannot do without.
    deleted.value = await dependencies.fetchDeleted(via).then(
      (result) => result.groups,
      () => deleted.value,
    )
  }

  /** Shows what the device holds while the first read runs, unless the read answered first. */
  async function showLocal(): Promise<void> {
    const local = await dependencies.readLocal?.().catch(() => undefined)
    if (local && inFlight && groups.value.length === 0) groups.value = local
  }

  function start(via: ReadChannel): Promise<void> {
    loading.value = true
    if (groups.value.length === 0) void showLocal()
    inFlight = readAll(via).then(
      () => {
        loadError.value = null
      },
      (cause) => {
        loadError.value = describeError(cause, appText(`Groups.loadFailed`))
        throw cause
      },
    ).finally(() => {
      inFlight = null
      loading.value = false
    })
    return inFlight
  }

  /**
   * Reads every group, over REST unless told otherwise. A read that is already running may have
   * started before the change that asked for this one, so it is not joined: exactly one more read
   * is queued behind it, and every call made meanwhile shares that one.
   */
  function refresh(via: ReadChannel = "rest"): Promise<void> {
    if (!inFlight) return start(via)
    queued ??= inFlight.catch(() => {}).then(() => {
      queued = null
      return start(via)
    })
    return queued
  }

  /** The refresh button: reads over the socket, and shows a failure instead of rejecting. */
  async function refreshFromUser(): Promise<void> {
    error.value = null
    try {
      await refresh("socket")
    } catch (cause) {
      error.value = describeError(cause, appText(`Groups.loadFailed`))
    }
  }

  /** The saved group with this id, or `undefined`. */
  function savedGroup(groupId: string): GroupItem | undefined {
    return groups.value.find((group) => group.id === groupId)
  }

  /** What the editor of a group (`null`: a new one) shows: what was typed, else the saved group. */
  function draft(groupId: string | null): GroupDraft {
    const typed = editor.value
    if (typed && typed.groupId === groupId) return typed.value
    const saved = groupId === null ? undefined : savedGroup(groupId)
    return saved ? draftOf(saved) : EMPTY_GROUP_DRAFT
  }

  /** Whether the editor of a group (`null`: a new one) holds something that is not saved. */
  function unsaved(groupId: string | null): boolean {
    const typed = editor.value
    if (!typed || typed.groupId !== groupId) return false
    const saved = groupId === null ? undefined : savedGroup(groupId)
    return !sameDraft(typed.value, saved ? draftOf(saved) : EMPTY_GROUP_DRAFT)
  }

  /** Keeps what the person typed in the editor of a group (`null`: a new one). */
  function edit(groupId: string | null, value: GroupDraft): void {
    editor.value = { groupId, value }
  }

  /**
   * Opens the editor of a group (`null`: a new one). What was typed for another group, and the
   * errors of an earlier attempt, are dropped: they belong to a page that is gone.
   */
  function openEditor(groupId: string | null): void {
    if (editor.value?.groupId !== groupId) editor.value = null
    editorErrors.value = {}
  }

  /** Puts the editor back to the group as saved, or empties the new group's form. */
  function discard(): void {
    editor.value = null
    editorErrors.value = {}
  }

  /**
   * Creates a group from the new group's form, every field in one request. Resolves the group once
   * it is created, `null` when the form had a mistake or the server refused it; the form keeps
   * what was typed either way.
   */
  async function create(): Promise<GroupItem | null> {
    if (creating.value) return null
    const checked = checkGroupDraft(draft(null))
    if (!checked.ok) {
      editorErrors.value = checked.errors
      return null
    }
    creating.value = true
    editorErrors.value = {}
    try {
      const { group } = await dependencies.create({
        id: dependencies.newId(),
        name: checked.name,
        ...checked.details,
      })
      groups.value = [group, ...groups.value.filter((existing) => existing.id !== group.id)]
      dependencies.advance(group.id, Number(group.changeSequence))
      if (editor.value?.groupId === null) editor.value = null
      return group
    } catch (cause) {
      editorErrors.value = {
        form: cause instanceof RealtimeRequestError
          ? describeError(cause, appText(GROUP_MESSAGES.create))
          : appText(GROUP_MESSAGES.createOffline),
      }
      return null
    } finally {
      creating.value = false
    }
  }

  /**
   * Runs one change of an existing group, showing it as in flight and its refusal as an error.
   * Resolves to whether it succeeded. A second change while one runs is refused.
   */
  async function change(
    groupId: string,
    action: GroupAction,
    run: () => Promise<void>,
    fallback: string,
  ): Promise<boolean> {
    if (working.value) return false
    working.value = { groupId, action }
    actionError.value = null
    try {
      await run()
      return true
    } catch (cause) {
      const plan = cause instanceof RealtimeRequestError ? readPlanRefusal(cause.details) : null
      actionError.value = {
        groupId,
        action,
        message: describeError(cause, fallback),
        ...(plan && { plan }),
      }
      return false
    } finally {
      working.value = null
    }
  }

  /**
   * Saves what the person typed in a group's editor: the name and the details, each only when it
   * changed. Resolves to whether everything was saved. A refusal keeps what was typed, and a name
   * saved before the details were refused stays saved.
   */
  async function save(groupId: string): Promise<boolean> {
    const saved = savedGroup(groupId)
    if (!saved || working.value) return false
    const checked = checkGroupDraft(draft(groupId))
    if (!checked.ok) {
      editorErrors.value = checked.errors
      return false
    }
    editorErrors.value = {}
    const before = draftOf(saved)
    const { name, details } = checked
    const done = await change(groupId, "save", async () => {
      // A rename and a details update answer without the members, so the row keeps the list's.
      const merge = (group: GroupItem) => {
        groups.value = groups.value.map((existing) =>
          existing.id === group.id ? { ...existing, ...group } : existing
        )
      }
      if (name !== before.name) merge((await dependencies.rename({ groupId, name })).group)
      if (
        details.description !== before.description || details.color !== before.color ||
        (details.emoji ?? "") !== before.emoji
      ) {
        merge((await dependencies.updateDetails({ groupId, ...details })).group)
      }
      // A failure that is not the server's answer means the server was not reached.
    }, appText(GROUP_MESSAGES.saveOffline))
    const failure = actionError.value
    if (done) {
      if (editor.value?.groupId === groupId) editor.value = null
    } else if (failure?.groupId === groupId && failure.action === "save") {
      editorErrors.value = { form: failure.message }
    }
    return done
  }

  /** Deletes a group. Resolves to whether it worked, so the page can leave the group's settings. */
  async function remove(groupId: string): Promise<boolean> {
    return await change(groupId, "delete", async () => {
      const { group } = await dependencies.remove({ groupId })
      groups.value = groups.value.filter((existing) => existing.id !== groupId)
      deleted.value = [group, ...deleted.value.filter((existing) => existing.id !== groupId)]
    }, appText(`Groups.deleteFailed`))
  }

  async function restore(groupId: string): Promise<boolean> {
    return await change(groupId, "restore", async () => {
      const { group } = await dependencies.restore({ groupId })
      deleted.value = deleted.value.filter((existing) => existing.id !== groupId)
      groups.value = [group, ...groups.value.filter((existing) => existing.id !== groupId)]
    }, appText(`Groups.restoreFailed`))
  }

  /**
   * Moves everything in a group to another group. Resolves to whether it worked; `moved` then holds
   * how many notes and tags went, and both groups follow through their own change events.
   */
  async function moveAll(groupId: string, toGroupId: string): Promise<boolean> {
    return await change(groupId, "moveAll", async () => {
      moved.value = null
      const result = await dependencies.moveAll({ groupId, toGroupId })
      moved.value = {
        groupId,
        toGroupId,
        count: result.counts.notes ?? 0,
        tags: result.counts.tags ?? 0,
      }
    }, appText(`GroupMoveAll.failed`))
  }

  /** Forgets a finished move and a refused one, when their dialog closes. */
  function forgetMoveAll(): void {
    moved.value = null
    if (actionError.value?.action === "moveAll") actionError.value = null
  }

  function reset(): void {
    moved.value = null
    groups.value = []
    deleted.value = []
    editor.value = null
    editorErrors.value = {}
    working.value = null
    actionError.value = null
    error.value = null
    loadError.value = null
    loading.value = true
    creating.value = false
    inFlight = null
    queued = null
  }

  return {
    groups,
    deleted,
    editor,
    editorErrors,
    draft,
    unsaved,
    edit,
    openEditor,
    discard,
    save,
    working,
    actionError,
    remove,
    restore,
    moveAll,
    moved,
    forgetMoveAll,
    loading,
    creating,
    error,
    loadError,
    refresh,
    refreshFromUser,
    create,
    reset,
  }
}

/** The groups as the server serves them: reads over REST, writes over the socket. */
export const onlineGroups: GroupsDependencies = {
  async fetchPage(cursor, via) {
    if (via === "socket") {
      return await callQuery<GroupPage>("group.list", {
        limit: PAGE_LIMIT,
        ...(cursor ? { cursor } : {}),
      })
    }
    const query = new URLSearchParams({ limit: String(PAGE_LIMIT) })
    if (cursor) query.set("cursor", cursor)
    const result = await apiAsUser<GroupPage>(`/api/groups?${query}`)
    if (!result.ok) throw new ReadRefused(result.error.message, result.status, result.error.reason)
    return result.data
  },
  async fetchDeleted(via) {
    if (via === "socket") {
      return await callQuery<{ groups: DeletedGroupItem[] }>("group.deleted")
    }
    const result = await apiAsUser<{ groups: DeletedGroupItem[] }>("/api/groups/deleted")
    if (!result.ok) throw new ReadRefused(result.error.message, result.status, result.error.reason)
    return result.data
  },
  create: (input) => callCommand("group.create", input),
  rename: (input) => callCommand("group.rename", input),
  updateDetails: (input) => callCommand("group.updateDetails", input),
  remove: (input) => callCommand("group.delete", input),
  restore: (input) => callCommand("group.restore", input),
  moveAll: (input) => callCommand("group.moveAll", input),
  advance: advanceGroupCursor,
  newId: () => uuidV7(),
}

/**
 * Keeps the groups list on this device (ADR 003, level 2): a REST read fetches the whole list,
 * which replaces the device's copy, and answers from the copy when the server is unreachable. The
 * copy is also what the store shows before the read answers. Creating a group needs the server.
 * The socket's read, which the refresh button makes, is not kept and has no fallback: the person
 * asked the server.
 */
export function groupsOnDevice(online: GroupsDependencies, reads: LocalReads): GroupsDependencies {
  return {
    ...online,
    async fetchPage(cursor, via) {
      if (via === "socket") return await online.fetchPage(cursor, via)
      const { value } = await reads.through(READ_KEYS.groups, async () => {
        const groups: GroupItem[] = []
        let next: string | null = cursor
        for (let page = 0; page < MAX_PAGES; page++) {
          const result = await online.fetchPage(next, via)
          groups.push(...result.groups)
          next = result.nextCursor
          if (next === null) break
        }
        return groups
      })
      return { groups: value, nextCursor: null }
    },
    readLocal: async () => (await reads.copy<GroupItem[]>(READ_KEYS.groups))?.value ?? [],
  }
}

/**
 * The page's own store: reads over REST (start-up and after a missed push), writes over the
 * socket, and with the local-data module running, served from the device when the server is
 * unreachable.
 */
export const groupsStore = createGroupsStore(groupsOnDevice(onlineGroups, localReads))
