import { expect } from "@std/expect"
import { it } from "@std/testing/bdd"
import { createToastStore } from "@spy4x/preact-signals/toast"
import type { ContactLinkRecord } from "@domain/contact-links"
import type { AdminApiResult, AdminFetch } from "../../state.ts"
import { createContactLinksState } from "./state.ts"

const ok = <T>(data: T) => ({ ok: true, status: 200, data }) as AdminApiResult<T>
const fail = (status: number, message: string) =>
  ({ ok: false, status, error: { status, message } }) as AdminApiResult<never>

const A = `0195f0b4-3c1e-7a00-8000-0000000000a1`
const B = `0195f0b4-3c1e-7a00-8000-0000000000b2`
const NEW = `0195f0b4-3c1e-7a00-8000-0000000000c3`

function linkOf(id: string, position: number): ContactLinkRecord {
  return {
    id,
    kind: `telegram`,
    value: `shop_${position}x`,
    label: null,
    position,
    createdAt: `2026-10-28T10:00:00.000Z`,
    updatedAt: `2026-10-28T10:00:00.000Z`,
    version: 3,
  }
}

/** A state over a fake API that lists two links, answers writes with `write` and records calls. */
function build(write: () => AdminApiResult<unknown> = () => ok({})) {
  const calls: string[] = []
  const request = ((path: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? `GET`} ${path}${init?.body ? ` ${init.body}` : ``}`)
    return Promise.resolve(
      init?.method === `POST` ? write() : ok({ links: [linkOf(A, 0), linkOf(B, 1)] }),
    )
  }) as AdminFetch
  const state = createContactLinksState(request, createToastStore(), () => NEW)
  return { state, calls }
}

it(`refuses a wrong value under its field before it asks the API`, async () => {
  const { state, calls } = build()
  state.open(null)
  state.edit({ kind: `telegram`, value: `my shop`, label: `` })

  expect(await state.save()).toBe(false)
  expect(state.editor.value.errors.value).toMatch(/Telegram username/)
  expect(calls).toEqual([])
})

it(`adds a link under a new id, then reads the list again with nothing left unsaved`, async () => {
  const { state, calls } = build()
  state.open(null)
  state.edit({ kind: `telegram`, value: `@my_shop`, label: `` })

  expect(await state.save()).toBe(true)
  expect(calls).toEqual([
    `POST /api/admin/contact-links {"id":"${NEW}","kind":"telegram","value":"@my_shop","label":""}`,
    `GET /api/admin/contact-links`,
  ])
})

it(`saves an edit with the version it read`, async () => {
  const { state, calls } = build()
  await state.load()
  state.open(A)
  state.edit({ kind: `email`, value: `a@example.com`, label: `Write` })

  expect(state.unsaved()).toBe(true)
  await state.save()
  expect(calls[1]).toBe(
    `POST /api/admin/contact-links/${A} {"kind":"email","value":"a@example.com","label":"Write","version":3}`,
  )
  expect(state.unsaved()).toBe(false)
})

it(`shows the API's refusal of a save under the form`, async () => {
  const { state } = build(() => fail(409, `Someone else changed this link.`))
  await state.load()
  state.open(A)
  state.edit({ kind: `telegram`, value: `other_shop`, label: `` })

  expect(await state.save()).toBe(false)
  expect(state.editor.value.errors).toEqual({ form: `Someone else changed this link.` })
})

it(`moves a link by sending every id in the new order`, async () => {
  const { state, calls } = build()
  await state.load()
  await state.move(B, -1)
  await state.move(A, -1)

  expect(calls[1]).toBe(`POST /api/admin/contact-links/order {"ids":["${B}","${A}"]}`)
  // The first link has nowhere to go up to.
  expect(calls.filter((call) => call.startsWith(`POST`))).toHaveLength(1)
})

it(`removes a link with its version, and shows a refusal above the list`, async () => {
  const { state, calls } = build(() => fail(404, `This link does not exist any more.`))
  await state.load()

  expect(await state.remove(linkOf(A, 0))).toBe(false)
  expect(calls[1]).toBe(`POST /api/admin/contact-links/${A}/delete {"version":3}`)
  expect(state.error.value).toBe(`This link does not exist any more.`)
})
