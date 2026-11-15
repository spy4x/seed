import { expect } from "@std/expect"
import { it } from "@std/testing/bdd"
import type { AdminImportListResponse } from "@domain/imports"
import type { AdminFetch } from "../../state.ts"
import { createImportsState } from "./state.ts"

const EMPTY: AdminImportListResponse = {
  imports: [],
  counts: { all: 0, failed: 0, reading: 0, ready: 0, committing: 0, committed: 0, undone: 0 },
  total: 0,
  page: 1,
  pageSize: 50,
}

it("reads the page the address asks for, and drops the answer for a page it left", async () => {
  const paths: string[] = []
  const answers: ((total: number) => void)[] = []
  const request = ((path: string): Promise<unknown> => {
    paths.push(path)
    return new Promise((resolve) =>
      answers.push((total) => resolve({ ok: true, data: { ...EMPTY, total } }))
    )
  }) as unknown as AdminFetch
  const state = createImportsState(request)

  const first = state.load({ status: `failed`, page: 2 })
  const second = state.load({ status: `all`, page: 1 })
  answers[1](7)
  answers[0](99)
  await Promise.all([first, second])

  expect(paths).toEqual([`/api/admin/imports?status=failed&page=2`, `/api/admin/imports`])
  expect(state.list.value.list?.total).toBe(7)
})

it("keeps the page it shows and says why when a read fails", async () => {
  let ok = true
  const request = (() =>
    Promise.resolve(
      ok
        ? { ok: true, data: { ...EMPTY, total: 3 } }
        : { ok: false, status: 500, error: { message: `Server error` } },
    )) as unknown as AdminFetch
  const state = createImportsState(request)
  await state.load({ status: `all`, page: 1 })
  ok = false
  await state.load({ status: `all`, page: 2 })
  expect(state.list.value).toMatchObject({ pending: false, error: `Server error` })
  expect(state.list.value.list?.total).toBe(3)
})
