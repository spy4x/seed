import type { ReadonlySignal } from "@preact/signals"
import { userChangeGroupId } from "@domain/identity"

/** What the pull reads and flushes: the stores, as far as the pull needs them. */
export interface PullDependencies {
  userId: number
  flushOutbox(): Promise<void>
  profile: { refresh(): Promise<void> }
  selection: { refresh(): Promise<void> }
  groups: { refresh(): Promise<void>; groups: ReadonlySignal<readonly { id: string }[]> }
  notes: { refresh(): Promise<void>; groupId: ReadonlySignal<string | null> }
  /** The members of the group whose settings are open. */
  members: { refresh(): Promise<void>; groupId: ReadonlySignal<string | null> }
  /** The inbox: its unread count, and its list while the page is open. */
  notifications: { refresh(): Promise<void> }
}

/**
 * The read that follows a hint, a reconnect or the start-up: a missed frame costs one read and
 * never leaves a list wrong. `gap` names the group whose hint arrived; none means "read all".
 *
 * The notes of the open group are read only after the groups list is read, and only while that
 * group is still in it. A group that was deleted, or that the person left, is gone from the list,
 * so its notes are never requested (the server would answer "not found").
 *
 * The cost: the notes read waits for the groups read, which includes the deleted-groups fetch, and
 * a groups read that fails rejects the pull before the notes are read. A failed groups read
 * therefore skips the notes refresh of that pull; the next pull (the next hint, a reconnect)
 * reads both again.
 *
 * The members of the group whose settings are open follow the same rule, so a member who was just
 * removed never asks for the members of a group they left.
 */
export function createPull(dependencies: PullDependencies) {
  const { userId, profile, selection, groups, notes, members, notifications } = dependencies
  return async (gap?: { groupId: string }): Promise<void> => {
    // The hint for this person's own changes (profile, push devices, selected group, inbox), sent
    // after a change in another tab or a new notification.
    if (gap?.groupId === userChangeGroupId(userId)) {
      await Promise.all([profile.refresh(), selection.refresh(), notifications.refresh()])
      return
    }
    // Writes made offline go out before anything is read, so the read shows their result.
    await dependencies.flushOutbox()
    const openGroup = notes.groupId.value
    const membersGroup = members.groupId.value
    // A group hint is not about the inbox; a start-up or a reconnect may have missed one.
    if (!gap) void notifications.refresh()
    await Promise.all([selection.refresh(), groups.refresh()])
    const due = (id: string | null) =>
      id !== null && groups.groups.value.some((g) => g.id === id) && (!gap || gap.groupId === id)
    await Promise.all([
      due(openGroup) ? notes.refresh() : undefined,
      due(membersGroup) ? members.refresh() : undefined,
    ])
  }
}

/** What {@link createChangeCheck} reads beside the pull: each group's change sequence. */
export interface ChangeCheckDependencies extends PullDependencies {
  groups: {
    refresh(): Promise<void>
    groups: ReadonlySignal<readonly { id: string; changeSequence: string }[]>
  }
}

/**
 * What a page with no socket runs in place of hints (ADR 003, "Changes"). `full` is the pull
 * itself: the start, the browser back online, the tab shown again. Otherwise it is the cheap check
 * the timer and the page's own write run: it reads the groups list, which carries every group's
 * change sequence, and reads the open group's notes (and the members of the group whose settings
 * are open) again only when that group's sequence is not the one they were last read at.
 *
 * The sequence kept is the list's, read before the notes: a change that lands between the two
 * reads moves the sequence again, so the next check reads the notes once more and never skips it.
 */
export function createChangeCheck(dependencies: ChangeCheckDependencies) {
  const { groups, notes, members } = dependencies
  const pull = createPull(dependencies)
  const stores = [["notes", notes], ["members", members]] as const
  /** The group and the sequence each list was last read at. */
  const held = new Map<string, { groupId: string; sequence: string }>()
  const sequenceOf = (id: string) => groups.groups.value.find((g) => g.id === id)?.changeSequence

  return async (full: boolean): Promise<void> => {
    if (full) {
      await pull()
      for (const [kind, store] of stores) {
        const groupId = store.groupId.value
        const sequence = groupId === null ? undefined : sequenceOf(groupId)
        if (groupId === null || sequence === undefined) held.delete(kind)
        else held.set(kind, { groupId, sequence })
      }
      return
    }
    await dependencies.flushOutbox()
    await groups.refresh()
    await Promise.all(stores.map(async ([kind, store]) => {
      const groupId = store.groupId.value
      // A group that is gone from the list is never asked for, as in the pull.
      const sequence = groupId === null ? undefined : sequenceOf(groupId)
      if (groupId === null || sequence === undefined) return
      const last = held.get(kind)
      if (last?.groupId === groupId && last.sequence === sequence) return
      await store.refresh()
      held.set(kind, { groupId, sequence })
    }))
  }
}
