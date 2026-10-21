import { expect } from "@std/expect"
import { it } from "@std/testing/bdd"
import type { AdminApiResult, AdminFetch } from "../../state.ts"
import { createAdminOverviewState } from "./overview.ts"

const GROUP_ID = `0199c3a0-0000-7000-8000-000000000001`
const october = {
  groupId: GROUP_ID,
  range: { from: `2026-10-01`, to: `2026-10-21` },
  timeZone: `Europe/Berlin`,
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

it(`reads every widget of the default layout for the group, the days and the zone`, async () => {
  const paths: string[] = []
  const request = ((path: string) => {
    paths.push(path)
    return Promise.resolve({ ok: true, status: 200, data: { current: 1, previous: null } })
  }) as AdminFetch
  const state = createAdminOverviewState(request)

  state.open(october)
  await settle()

  const query = `from=2026-10-01&to=2026-10-21&timeZone=Europe%2FBerlin`
  expect(paths).toEqual([
    `/api/admin/groups/${GROUP_ID}/widgets/notes.total?${query}`,
    `/api/admin/groups/${GROUP_ID}/widgets/notes.added?${query}`,
    `/api/admin/groups/${GROUP_ID}/widgets/notes.over-time?${query}`,
  ])
  expect(state.loads.value[`notes.total`]).toEqual({
    status: `ready`,
    data: { current: 1, previous: null },
    savedAt: null,
  })
})

it(`shows a refused widget as failed and reads it again on retry`, async () => {
  let refuse = true
  const request = ((path: string) =>
    Promise.resolve(
      path.includes(`notes.added`) && refuse
        ? { ok: false, status: 500, error: { message: `boom` } }
        : { ok: true, status: 200, data: { current: 2, previous: 1 } },
    ) as Promise<AdminApiResult<unknown>>) as AdminFetch
  const state = createAdminOverviewState(request)

  state.open(october)
  await settle()
  expect(state.loads.value[`notes.added`]).toEqual({ status: `error` })

  refuse = false
  state.retry(`notes.added`)
  await settle()
  expect(state.loads.value[`notes.added`].status).toBe(`ready`)
})

it(`drops an answer for a range the page has moved on from`, async () => {
  let release!: () => void
  const held = new Promise<void>((resolve) => release = resolve)
  let calls = 0
  const request = (async () => {
    const mine = ++calls
    if (mine === 1) await held
    return { ok: true, status: 200, data: { current: mine, previous: null } }
  }) as unknown as AdminFetch
  const state = createAdminOverviewState(request)

  state.open(october)
  state.open({ ...october, range: { from: `2026-10-15`, to: `2026-10-21` } })
  await settle()
  release()
  await settle()

  expect(state.loads.value[`notes.total`]).toEqual({
    status: `ready`,
    data: { current: 4, previous: null },
    savedAt: null,
  })
})
