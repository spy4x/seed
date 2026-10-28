import { expect } from "@std/expect"
import { it } from "@std/testing/bdd"
import { createToastStore } from "@spy4x/preact-signals/toast"
import {
  ADMIN_GROUP_NO_FILTER,
  type AdminGroupDetail,
  type AdminGroupFile,
  GroupRole,
} from "@domain/groups"
import { UserRole } from "@domain/identity"
import type { AdminApiResult, AdminFetch } from "../../state.ts"
import { createGroupsState, type GroupsFilePorts } from "./state.ts"

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

/** The sign-out of a test that expects none: it fails the test. */
const stayed = () => {
  throw new Error(`signed out`)
}

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
  const state = createGroupsState(request, createToastStore(), stayed)
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
  const state = createGroupsState(request, createToastStore(), stayed)
  const late = state.loadList(first)
  await state.loadList(ADMIN_GROUP_NO_FILTER)
  answerFirst(ok({ groups: [], total: 99, page: 1, pageSize: 25 }))
  await late
  expect(state.list.value.list?.total).toBe(3)
})

it(`sends each confirmed action to its path, toasts, and shows the group the API answered`, async () => {
  const { request, calls } = fakeRequest()
  const toasts = createToastStore()
  const state = createGroupsState(request, toasts, stayed)
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
  const state = createGroupsState(request, toasts, stayed)
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
  const state = createGroupsState(request, createToastStore(), stayed)
  await state.loadGroup(GROUP_ID)
  state.openDialog({ kind: `remove`, userId: 43 })
  const first = state.act({ kind: `remove`, userId: 43 })
  await state.act({ kind: `remove`, userId: 43 })
  answer(ok({ group: after }))
  await first
  expect(calls.filter((call) => call.startsWith(`POST`)).length).toBe(1)
})

const FILE_ID = `0199c3a0-0000-7000-8000-000000000003`
const usage = { files: 1, bytes: 10, maxFiles: 100, maxBytes: 1000 }
const file = { id: FILE_ID, name: `receipt.pdf` } as AdminGroupFile

it(`reads a page of files with its search, and drops an answer for a search the page has left`, async () => {
  const page = { files: [file], total: 1, page: 2, pageSize: 25, query: `rec`, usage }
  let answer: (value: AdminApiResult<unknown>) => void = () => {}
  const { request, calls } = fakeRequest((path) =>
    path.includes(`/files?q=old`)
      ? new Promise((resolve) => answer = resolve)
      : path.includes(`/files`)
      ? Promise.resolve(ok(page))
      : undefined
  )
  const state = createGroupsState(request, createToastStore(), stayed)
  const stale = state.loadFiles(GROUP_ID, { query: `old`, page: 1 })
  const filter = { query: `rec`, page: 2 }
  await state.loadFiles(GROUP_ID, filter)
  answer(ok({ ...page, query: `old` }))
  await stale

  expect(calls).toEqual([
    `GET /api/admin/groups/${GROUP_ID}/files?q=old`,
    `GET /api/admin/groups/${GROUP_ID}/files?q=rec&page=2`,
  ])
  expect(state.files.value).toEqual({
    groupId: GROUP_ID,
    filter,
    files: page,
    error: null,
    notice: null,
  })
})

it(`removes a file, answers the same page of files as the dialog closes, then reads the group`, async () => {
  const before = { files: [file], total: 1, page: 1, pageSize: 25, query: `rec`, usage }
  const emptied = { ...before, files: [], total: 0, usage: { ...usage, files: 0, bytes: 0 } }
  const { request, calls } = fakeRequest((path, init) => {
    if (init?.method === `POST`) return Promise.resolve(ok(emptied))
    if (path.includes(`/files`)) return Promise.resolve(ok(before))
    return undefined
  })
  const toasts = createToastStore()
  const state = createGroupsState(request, toasts, stayed)
  await state.loadGroup(GROUP_ID)
  await state.loadFiles(GROUP_ID, { query: `rec`, page: 1 })

  state.openDialog({ kind: `removeFile`, fileId: FILE_ID })
  const seen: unknown[] = []
  const stop = state.files.subscribe((value) => seen.push([value.files, state.dialog.value.dialog]))
  await state.act({ kind: `removeFile`, fileId: FILE_ID })
  stop()

  expect(calls.slice(2)).toEqual([
    `POST /api/admin/groups/${GROUP_ID}/files/${FILE_ID}/remove?q=rec`,
    `GET /api/admin/groups/${GROUP_ID}`,
  ])
  // Never the new files under an open dialog: the list moves focus only once the dialog is gone.
  expect(seen).toEqual([[before, { kind: `removeFile`, fileId: FILE_ID }], [emptied, null]])
  expect(state.group.value.detail).toBe(detail)
  expect(toasts.list.value.map((toast) => toast.body)).toEqual([`The file is removed from Family.`])
})

it(`keeps the files' own message when they fail to load`, async () => {
  const { request } = fakeRequest((path) =>
    path.includes(`/files`) ? Promise.resolve(fail(500, `The files did not load`)) : undefined
  )
  const state = createGroupsState(request, createToastStore(), stayed)
  await state.loadGroup(GROUP_ID)
  await state.loadFiles(GROUP_ID, { query: ``, page: 1 })
  expect(state.group.value.detail).toBe(detail)
  expect(state.files.value.files).toBe(null)
  expect(state.files.value.error).toBe(`The files did not load`)
})

/** Download ports that answer `response` (or throw) and record what was fetched and saved. */
function filePorts(response: () => Response) {
  const fetched: string[] = []
  const saved: string[] = []
  const ports: GroupsFilePorts = {
    fetch: (path, init) => {
      fetched.push(`${path} ${init.credentials}`)
      return Promise.resolve(response())
    },
    save: (_response, filename) => (saved.push(filename), Promise.resolve()),
  }
  return { ports, fetched, saved }
}

it(`saves a downloaded file under its own name through the admin API`, async () => {
  const { ports, fetched, saved } = filePorts(() => new Response(`%PDF`))
  const state = createGroupsState(fakeRequest().request, createToastStore(), stayed, ports)
  await state.downloadFile(GROUP_ID, file)
  expect(fetched).toEqual([`/api/admin/groups/${GROUP_ID}/files/${FILE_ID}/download same-origin`])
  expect(saved).toEqual([`receipt.pdf`])
  expect(state.files.value.notice).toBe(null)
})

it(`says a file is gone and reads the list again when its download answers 404`, async () => {
  const { ports, saved } = filePorts(() => new Response(`{}`, { status: 404 }))
  const { request, calls } = fakeRequest((path) =>
    path.includes(`/files`)
      ? Promise.resolve(ok({ files: [], total: 0, page: 1, pageSize: 25, query: ``, usage }))
      : undefined
  )
  const state = createGroupsState(request, createToastStore(), stayed, ports)
  await state.loadFiles(GROUP_ID, { query: ``, page: 1 })
  await state.downloadFile(GROUP_ID, file)
  expect(saved).toEqual([])
  expect(state.files.value.notice).toBe(`This file is gone. Someone may have removed it already.`)
  expect(calls).toEqual([
    `GET /api/admin/groups/${GROUP_ID}/files`,
    `GET /api/admin/groups/${GROUP_ID}/files`,
  ])
})

it(`shows the API's reason, or a plain failure offline, when a download fails`, async () => {
  const refused = filePorts(() =>
    Response.json({ error: { code: `forbidden`, message: `Not from here` } }, { status: 403 })
  )
  const state = createGroupsState(fakeRequest().request, createToastStore(), stayed, refused.ports)
  await state.loadFiles(GROUP_ID, { query: ``, page: 1 })
  await state.downloadFile(GROUP_ID, file)
  expect(state.files.value.notice).toBe(`Not from here`)

  const offline = filePorts(() => {
    throw new TypeError(`Failed to fetch`)
  })
  const again = createGroupsState(fakeRequest().request, createToastStore(), stayed, offline.ports)
  await again.loadFiles(GROUP_ID, { query: ``, page: 1 })
  await again.downloadFile(GROUP_ID, file)
  expect(again.files.value.notice).toBe(`Something went wrong. Try again.`)
})

it(`signs the app out when a download answers 401, as every other call does`, async () => {
  const { ports, saved } = filePorts(() => Response.json({}, { status: 401 }))
  let signOuts = 0
  const state = createGroupsState(fakeRequest().request, createToastStore(), () => {
    signOuts++
  }, ports)
  await state.loadFiles(GROUP_ID, { query: ``, page: 1 })
  await state.downloadFile(GROUP_ID, file)
  expect(signOuts).toBe(1)
  expect(saved).toEqual([])
  expect(state.files.value.notice).toBe(null)
})
