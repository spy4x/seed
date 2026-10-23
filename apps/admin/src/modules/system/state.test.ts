import { expect } from "@std/expect"
import { it } from "@std/testing/bdd"
import type { AdminSystemSnapshot } from "@domain/identity"
import type { AdminApiResult, AdminFetch } from "../../state.ts"
import { createSystemState } from "./state.ts"

const ok = <T>(data: T) => ({ ok: true, status: 200, data }) as AdminApiResult<T>
const fail = <T>(status: number, message: string) =>
  ({ ok: false, status, error: { message } }) as AdminApiResult<T>

const snapshot = { checkedAt: "2026-10-16T09:00:00.000Z" } as AdminSystemSnapshot

it("reads the stack, and keeps the last reading when a new one fails", async () => {
  let down = false
  const request =
    (() => Promise.resolve(down ? fail(500, `Down.`) : ok(snapshot))) as unknown as AdminFetch
  const state = createSystemState(request)
  await state.refresh()
  down = true
  await state.refresh()

  expect(state.read.value).toEqual({ snapshot, pending: false, error: `Down.` })
})
