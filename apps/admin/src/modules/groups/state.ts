import { signal } from "@preact/signals"
import type { ToastStore } from "@spy4x/preact-signals/toast"
import {
  type AdminGroupDetail,
  type AdminGroupFiles,
  type AdminGroupFilter,
  adminGroupFilterQuery,
  type AdminGroupListResponse,
} from "@domain/groups"
import type { AdminGroupAction, AdminGroupDialog } from "@ui/admin-groups-detail.tsx"
import { adminGroupPersonName } from "@ui/admin-groups-list.tsx"
import { type AdminFetch, post } from "../../state.ts"

export interface GroupsListState {
  /** The filter of the page the list shows, or is loading. */
  filter: AdminGroupFilter | null
  list: AdminGroupListResponse | null
  pending: boolean
  error: string | null
}

export interface GroupsGroupState {
  groupId: string | null
  detail: AdminGroupDetail | null
  error: string | null
}

export interface GroupsFilesState {
  groupId: string | null
  files: AdminGroupFiles | null
  error: string | null
}

export interface GroupsDialogState {
  dialog: AdminGroupDialog | null
  /** Why the API refused the action, or `null`. */
  error: string | null
  pending: boolean
}

const NO_DIALOG: GroupsDialogState = { dialog: null, error: null, pending: false }

/** The request of each action: its path under `/api/admin/groups/:id/` and its body. */
function actionRequest(action: AdminGroupAction): { path: string; body?: unknown } {
  switch (action.kind) {
    case `remove`:
      return { path: `members/${action.userId}/remove` }
    case `revoke`:
      return { path: `invitations/${encodeURIComponent(action.invitationId)}/revoke` }
    case `transfer`:
      return { path: `transfer`, body: { userId: action.userId } }
    case `removeFile`:
      return { path: `files/${encodeURIComponent(action.fileId)}/remove` }
  }
}

/** What the toast says after an action went through, naming whom it touched. */
function actionDone(action: AdminGroupAction, detail: AdminGroupDetail | null): string {
  const group = detail?.group.name ?? `the group`
  const member = (userId: number) => {
    const found = detail?.members.find((row) => row.id === userId)
    return found ? adminGroupPersonName(found) : `The member`
  }
  switch (action.kind) {
    case `remove`:
      return `${member(action.userId)} is no longer in ${group}.`
    case `revoke`:
      return `The invitation to ${group} is revoked.`
    case `transfer`:
      return `${member(action.userId)} now owns ${group}.`
    case `removeFile`:
      return `The file is removed from ${group}.`
  }
}

/**
 * The groups module's state: the list, the open group and the action dialog. Every call goes
 * through the app's `request`, which signs the app out on a 401, so this state never handles one.
 */
export function createGroupsState(request: AdminFetch, toasts: ToastStore) {
  const list = signal<GroupsListState>({ filter: null, list: null, pending: false, error: null })
  const group = signal<GroupsGroupState>({ groupId: null, detail: null, error: null })
  const files = signal<GroupsFilesState>({ groupId: null, files: null, error: null })
  const dialog = signal<GroupsDialogState>(NO_DIALOG)

  /** The group's files, read beside its page; an answer for a group the page has left is dropped. */
  async function loadFiles(groupId: string): Promise<void> {
    if (files.value.groupId !== groupId) files.value = { groupId, files: null, error: null }
    const result = await request<AdminGroupFiles>(
      `/api/admin/groups/${encodeURIComponent(groupId)}/files`,
    )
    if (files.value.groupId !== groupId) return
    files.value = result.ok
      ? { groupId, files: result.data, error: null }
      : { groupId, files: null, error: result.error.message }
  }

  async function loadGroup(groupId: string): Promise<void> {
    if (group.value.groupId !== groupId) {
      group.value = { groupId, detail: null, error: null }
    }
    const [result] = await Promise.all([
      request<AdminGroupDetail>(`/api/admin/groups/${encodeURIComponent(groupId)}`),
      loadFiles(groupId),
    ])
    if (group.value.groupId !== groupId) return
    group.value = result.ok
      ? { groupId, detail: result.data, error: null }
      : { groupId, detail: null, error: result.error.message }
  }

  return {
    list,
    group,
    files,
    dialog,

    async loadList(filter: AdminGroupFilter): Promise<void> {
      list.value = { ...list.value, filter, pending: true, error: null }
      const query = adminGroupFilterQuery(filter)
      const result = await request<AdminGroupListResponse>(
        `/api/admin/groups${query ? `?${query}` : ``}`,
      )
      // An answer for a filter the page has left is dropped.
      if (list.value.filter !== filter) return
      list.value = result.ok
        ? { filter, list: result.data, pending: false, error: null }
        : { ...list.value, pending: false, error: result.error.message }
    },

    loadGroup,

    openDialog(next: AdminGroupDialog): void {
      dialog.value = { dialog: next, error: null, pending: false }
    },

    closeDialog(): void {
      if (dialog.value.pending) return
      dialog.value = NO_DIALOG
    },

    /**
     * Sends the confirmed action. It asks for no password: the API records the operator in the
     * group's activity. On success the dialog closes, a toast says what happened, and the page
     * shows the group as the API answered it. A file's removal answers the files, and the page
     * reads the group again for its counts.
     */
    async act(action: AdminGroupAction): Promise<void> {
      const { dialog: open, pending } = dialog.value
      const { groupId, detail } = group.value
      if (!open || pending || groupId === null) return
      dialog.value = { dialog: open, error: null, pending: true }
      const { path, body } = actionRequest(action)
      const result = await request<{ group: AdminGroupDetail } | AdminGroupFiles>(
        `/api/admin/groups/${encodeURIComponent(groupId)}/${path}`,
        post(body),
      )
      if (!result.ok) {
        dialog.value = { dialog: open, error: result.error.message, pending: false }
        return
      }
      dialog.value = NO_DIALOG
      toasts.success({ body: actionDone(action, detail), dataE2E: `admin-group-toast` })
      if (action.kind === `removeFile`) {
        if (files.value.groupId === groupId && result.data && `usage` in result.data) {
          files.value = { groupId, files: result.data, error: null }
        }
        await loadGroup(groupId)
        return
      }
      if (group.value.groupId === groupId && result.data && `group` in result.data) {
        group.value = { groupId, detail: result.data.group, error: null }
      }
    },
  }
}

export type GroupsState = ReturnType<typeof createGroupsState>
