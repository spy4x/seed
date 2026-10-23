import { expect } from "@std/expect"
import { it } from "@std/testing/bdd"
import { createToastStore } from "@spy4x/preact-signals/toast"
import {
  ADMIN_GROUP_NO_FILTER,
  type AdminGroupDetail,
  type AdminGroupFiles,
  GroupRole,
} from "@domain/groups"
import { UserRole } from "@domain/identity"
import type { AdminApiResult, AdminFetch } from "../../state.ts"
import { createGroupsState } from "./state.ts"

const GROUP_ID = `0199c3a0-0000-7000-8000-000000000001`
const INVITATION_ID = `0199c3a0-0000-7000-8000-000000000002`

const detail = {
  group: { id: GROUP_ID, name: `Family` },
  members: [{
    id: 43,
    name: `Grace Hopper`,
    email: `grace@example.com`,
    role: GroupRole.EDITOR,
    userRole: UserRole.VIEWER,
  }],
} as AdminGroupDetail
const after = { ...detail, members: [] } as AdminGroupDetail

const ok = <T>(data: T, status = 200) => ({ ok: true, status, data }) as AdminApiResult<T>
const fail = <T>(status: number, message: string) =>
  ({ ok: false, status, error: { message } }) as AdminApiResult<T>

type Answer = (path: string, init?: RequestInit) => Promise<AdminApiResult<unknown>> | undefined

/** A `request` that answers from `answer` (or a plain success) and records each call and body. */
function fakeRequest(answer: Answer = () => undefined) {
  const calls: string[] = []
  const request = ((path: string, init?: RequestInit) => {
    const body = init?.body === undefined ? `` : ` ${init.body}`
    calls.push(`${init?.method ?? `GET`} ${path}${body}`)
    const fallback = init?.method === `POST`
      ? ok({ group: after })
      : path.endsWith(GROUP_ID)
      ? ok(detail)
      : ok({ groups: [], total: 0, page: 1, pageSize: 25 })
    return answer(path, init) ?? Promise.resolve(fallback)
  }) as AdminFetch
  return { request, calls }
}

it(`reads the group list with the search, status and sort in the query`, async () => {
  const { request, calls } = fakeRequest()
  const state = createGroupsState(request, createToastStore())
  await state.loadList({
    ...ADMIN_GROUP_NO_FILTER,
    query: `ada`,
    status: `deleted`,
    sort: [{ key: `memberCount`, direction: `desc` }],
  })
  expect(calls).toEqual([`GET /api/admin/groups?q=ada&status=deleted&sort=memberCount%3Adesc`])
})

it(`drops a group list answer for a filter the page has left`, async () => {
  let answerFirst: (value: AdminApiResult<unknown>) => void = () => {}
  const first = { ...ADMIN_GROUP_NO_FILTER, query: `ada` }
  const { request } = fakeRequest((path) =>
    path.includes(`q=ada`)
      ? new Promise((resolve) => answerFirst = resolve)
      : Promise.resolve(ok({ groups: [], total: 3, page: 1, pageSize: 25 }))
  )
  const state = createGroupsState(request, createToastStore())
  const late = state.loadList(first)
  await state.loadList(ADMIN_GROUP_NO_FILTER)
  answerFirst(ok({ groups: [], total: 99, page: 1, pageSize: 25 }))
  await late
  expect(state.list.value.list?.total).toBe(3)
})

it(`sends each confirmed action to its path, toasts, and shows the group the API answered`, async () => {
  const { request, calls } = fakeRequest()
  const toasts = createToastStore()
  const state = createGroupsState(request, toasts)
  await state.loadGroup(GROUP_ID)

  state.openDialog({ kind: `remove`, userId: 43 })
  await state.act({ kind: `remove`, userId: 43 })
  expect(state.group.value.detail).toBe(after)
  state.group.value = { ...state.group.value, detail }
  state.openDialog({ kind: `revoke`, invitationId: INVITATION_ID })
  await state.act({ kind: `revoke`, invitationId: INVITATION_ID })
  state.openDialog({ kind: `transfer` })
  await state.act({ kind: `transfer`, userId: 43 })

  expect(calls).toEqual([
    `GET /api/admin/groups/${GROUP_ID}`,
    `GET /api/admin/groups/${GROUP_ID}/files`,
    `POST /api/admin/groups/${GROUP_ID}/members/43/remove`,
    `POST /api/admin/groups/${GROUP_ID}/invitations/${INVITATION_ID}/revoke`,
    `POST /api/admin/groups/${GROUP_ID}/transfer {"userId":43}`,
  ])
  expect(state.dialog.value).toEqual({ dialog: null, error: null, pending: false })
  expect(toasts.list.value.map((toast) => toast.body)).toEqual([
    `Grace Hopper is no longer in Family.`,
    `The invitation to Family is revoked.`,
    `The member now owns Family.`,
  ])
})

it(`keeps the dialog open with the API's message and no toast when it refuses`, async () => {
  const message = `This is the only group of that person`
  const { request } = fakeRequest((_path, init) =>
    init?.method === `POST` ? Promise.resolve(fail(409, message)) : undefined
  )
  const toasts = createToastStore()
  const state = createGroupsState(request, toasts)
  await state.loadGroup(GROUP_ID)
  state.openDialog({ kind: `remove`, userId: 43 })
  await state.act({ kind: `remove`, userId: 43 })
  expect(state.dialog.value).toEqual({
    dialog: { kind: `remove`, userId: 43 },
    error: message,
    pending: false,
  })
  expect(state.group.value.detail).toBe(detail)
  expect(toasts.list.value).toEqual([])
})

it(`sends nothing more on a second confirm while the action is on its way`, async () => {
  let answer: (value: AdminApiResult<unknown>) => void = () => {}
  const { request, calls } = fakeRequest((_path, init) =>
    init?.method === `POST` ? new Promise((resolve) => answer = resolve) : undefined
  )
  const state = createGroupsState(request, createToastStore())
  await state.loadGroup(GROUP_ID)
  state.openDialog({ kind: `remove`, userId: 43 })
  const first = state.act({ kind: `remove`, userId: 43 })
  await state.act({ kind: `remove`, userId: 43 })
  answer(ok({ group: after }))
  await first
  expect(calls.filter((call) => call.startsWith(`POST`)).length).toBe(1)
})

it(`reads the files beside the group, removes one, and reads the group again for its counts`, async () => {
  const FILE_ID = `0199c3a0-0000-7000-8000-000000000003`
  const usage = { files: 1, bytes: 10, maxFiles: 100, maxBytes: 1000 }
  const before = { files: [{ id: FILE_ID }], usage } as AdminGroupFiles
  const emptied = { files: [], usage: { ...usage, files: 0, bytes: 0 } } as AdminGroupFiles
  let removed = false
  const { request, calls } = fakeRequest((path, init) => {
    if (init?.method === `POST`) {
      removed = true
      return Promise.resolve(ok(emptied))
    }
    if (path.endsWith(`/files`)) return Promise.resolve(ok(removed ? emptied : before))
    return undefined
  })
  const toasts = createToastStore()
  const state = createGroupsState(request, toasts)
  await state.loadGroup(GROUP_ID)
  expect(state.files.value).toEqual({ groupId: GROUP_ID, files: before, error: null })

  state.openDialog({ kind: `removeFile`, fileId: FILE_ID })
  await state.act({ kind: `removeFile`, fileId: FILE_ID })

  expect(calls.slice(2)).toEqual([
    `POST /api/admin/groups/${GROUP_ID}/files/${FILE_ID}/remove`,
    `GET /api/admin/groups/${GROUP_ID}`,
    `GET /api/admin/groups/${GROUP_ID}/files`,
  ])
  expect(state.files.value.files).toEqual(emptied)
  expect(state.group.value.detail).toBe(detail)
  expect(toasts.list.value.map((toast) => toast.body)).toEqual([`The file is removed from Family.`])
})

it(`keeps the group's page when its files fail to load, with their own message`, async () => {
  const { request } = fakeRequest((path) =>
    path.endsWith(`/files`) ? Promise.resolve(fail(500, `The files did not load`)) : undefined
  )
  const state = createGroupsState(request, createToastStore())
  await state.loadGroup(GROUP_ID)
  expect(state.group.value.detail).toBe(detail)
  expect(state.files.value).toEqual({
    groupId: GROUP_ID,
    files: null,
    error: `The files did not load`,
  })
})
