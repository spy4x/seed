import { batch, signal } from "@preact/signals"
import type { ToastStore } from "@spy4x/preact-signals/toast"
import { downloadResponseAsFile } from "@spy4x/platform/browser/download"
import {
  type AdminGroupDetail,
  type AdminGroupFile,
  type AdminGroupFileFilter,
  adminGroupFileFilterQuery,
  adminGroupFilePath,
  type AdminGroupFiles,
  type AdminGroupFilter,
  adminGroupFilterQuery,
  type AdminGroupListResponse,
} from "@domain/groups"
import { readApiError } from "@domain/errors"
import type { AdminGroupAction, AdminGroupDialog } from "@ui/admin-groups-detail.tsx"
import { adminGroupPersonName } from "@ui/admin-groups-list.tsx"
import { adminFailure, type AdminFetch, post, refusalText } from "../../state.ts"
import { adminText } from "../../i18n.ts"

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
  /** The search and page shown, or being read. */
  filter: AdminGroupFileFilter | null
  files: AdminGroupFiles | null
  error: string | null
  /** Why opening or downloading a file failed, or `null`. */
  notice: string | null
}

/** What a download needs from the platform: a raw `fetch` and the file save. Tests pass fakes. */
export interface GroupsFilePorts {
  fetch: (path: string, init: RequestInit) => Promise<Response>
  save: (response: Response, filename: string) => Promise<void>
}

const browserFiles: GroupsFilePorts = {
  fetch: (path, init) => fetch(path, init),
  save: (response, filename) => downloadResponseAsFile(response, filename),
}

/** The notice when the file to download is gone: the same words as the API's 404 on a removal. */
const FILE_GONE = `AdminGroup.fileGone`

const NO_FILES: GroupsFilesState = {
  groupId: null,
  filter: null,
  files: null,
  error: null,
  notice: null,
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
  const t = adminText()
  const group = detail?.group.name ?? t.t(`AdminGroup.theGroup`)
  const member = (userId: number) => {
    const found = detail?.members.find((row) => row.id === userId)
    return found ? adminGroupPersonName(t, found) : t.t(`AdminGroup.theMember`)
  }
  switch (action.kind) {
    case `remove`:
      return t.t(`AdminGroup.doneRemove`, { member: member(action.userId), group })
    case `revoke`:
      return t.t(`AdminGroup.doneRevoke`, { group })
    case `transfer`:
      return t.t(`AdminGroup.doneTransfer`, { member: member(action.userId), group })
    case `removeFile`:
      return t.t(`AdminGroup.doneRemoveFile`, { group })
  }
}

/**
 * The groups module's state: the list, the open group and the action dialog. Every JSON call goes
 * through the app's `request`, which signs the app out on a 401. A download reads bytes, not JSON,
 * so it calls `fetch` itself and calls `signedOut` on a 401 the same way.
 */
export function createGroupsState(
  request: AdminFetch,
  toasts: ToastStore,
  signedOut: () => void,
  ports: GroupsFilePorts = browserFiles,
) {
  const list = signal<GroupsListState>({ filter: null, list: null, pending: false, error: null })
  const group = signal<GroupsGroupState>({ groupId: null, detail: null, error: null })
  const files = signal<GroupsFilesState>(NO_FILES)
  const dialog = signal<GroupsDialogState>(NO_DIALOG)

  /** The group's files path with the search and page: `…/files?q=receipt&page=2`. */
  function filesPath(groupId: string, filter: AdminGroupFileFilter, suffix = ``): string {
    const query = adminGroupFileFilterQuery(filter)
    return `/api/admin/groups/${encodeURIComponent(groupId)}/files${suffix}${
      query ? `?${query}` : ``
    }`
  }

  /**
   * One page of the group's files. The rows give way to the loading state until it comes; an
   * answer for a group or a search the page has left is dropped.
   */
  async function loadFiles(groupId: string, filter: AdminGroupFileFilter): Promise<void> {
    files.value = { ...NO_FILES, groupId, filter }
    const result = await request<AdminGroupFiles>(filesPath(groupId, filter))
    if (files.value.groupId !== groupId || files.value.filter !== filter) return
    files.value = result.ok
      ? { ...files.value, files: result.data, error: null }
      : { ...files.value, files: null, error: result.error.message }
  }

  async function loadGroup(groupId: string): Promise<void> {
    if (group.value.groupId !== groupId) {
      group.value = { groupId, detail: null, error: null }
    }
    const result = await request<AdminGroupDetail>(
      `/api/admin/groups/${encodeURIComponent(groupId)}`,
    )
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
    loadFiles,

    /**
     * Saves one file to the device: the bytes come through the admin API, which writes the audit
     * row. A file someone removed shows a notice above the list and the list is read again; the
     * admin app never navigates to an error page.
     */
    async downloadFile(groupId: string, file: AdminGroupFile): Promise<void> {
      files.value = { ...files.value, notice: null }
      let notice: string
      try {
        const response = await ports.fetch(adminGroupFilePath(groupId, file.id, `download`), {
          credentials: `same-origin`,
        })
        if (response.ok) {
          await ports.save(response, file.name)
          return
        }
        if (response.status === 401) return signedOut()
        notice = response.status === 404
          ? adminText().t(FILE_GONE)
          : refusalText(readApiError(await response.json().catch(() => null)))
        if (response.status === 404 && files.value.groupId === groupId && files.value.filter) {
          await loadFiles(groupId, files.value.filter)
        }
      } catch {
        notice = adminFailure()
      }
      if (files.value.groupId === groupId) files.value = { ...files.value, notice }
    },

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
     * shows the group as the API answered it. A file's removal answers the same page of files, in
     * the same render that closes the dialog, so the list moves focus to the next row; then the
     * page reads the group again for its counts.
     */
    async act(action: AdminGroupAction): Promise<void> {
      const { dialog: open, pending } = dialog.value
      const { groupId, detail } = group.value
      if (!open || pending || groupId === null) return
      dialog.value = { dialog: open, error: null, pending: true }
      const { path, body } = actionRequest(action)
      // A file's removal answers the page of files it was made from.
      const filter = files.value.groupId === groupId ? files.value.filter : null
      const query = action.kind === `removeFile` && filter ? adminGroupFileFilterQuery(filter) : ``
      const result = await request<{ group: AdminGroupDetail } | AdminGroupFiles>(
        `/api/admin/groups/${encodeURIComponent(groupId)}/${path}${query ? `?${query}` : ``}`,
        post(body),
      )
      if (!result.ok) {
        dialog.value = { dialog: open, error: result.error.message, pending: false }
        return
      }
      const answer = result.data
      batch(() => {
        dialog.value = NO_DIALOG
        if (
          action.kind === `removeFile` && files.value.groupId === groupId && answer &&
          `usage` in answer
        ) {
          files.value = { ...files.value, files: answer, error: null, notice: null }
        }
      })
      toasts.success({ body: actionDone(action, detail), dataE2E: `admin-group-toast` })
      if (action.kind === `removeFile`) {
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
