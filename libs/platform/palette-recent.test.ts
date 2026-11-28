import { expect } from "@std/expect"
import { it } from "@std/testing/bdd"
import { memoryStorage } from "@spy4x/platform/browser/storage"
import type { KeyValueStore } from "@spy4x/platform/universal/key-value-store"
import {
  createPaletteRecent,
  OPENED_KEPT,
  PALETTE_OPENED_KEY,
  PALETTE_RECENT_KEY,
} from "./palette-recent.ts"

const ADA = { kind: `user`, id: `42`, name: `Ada Lovelace` } as const
const TEAM = { kind: `group`, id: `0199c3a0-0000-7000-8000-000000000001`, name: `Team` } as const

it("forgets the recent picks and the opened records it kept, and leaves the device's other keys", () => {
  const storage = memoryStorage()
  storage.setItem(PALETTE_RECENT_KEY, `["go-notes"]`)
  storage.setItem(`theme`, `dark`)
  const recent = createPaletteRecent(storage)
  expect(recent.storage()).toBe(storage)
  recent.open(ADA)

  recent.forget()

  expect(storage.getItem(PALETTE_RECENT_KEY)).toBe(null)
  expect(storage.getItem(PALETTE_OPENED_KEY)).toBe(null)
  expect(recent.opened.value).toEqual([])
  expect(createPaletteRecent(storage).opened.value).toEqual([])
  expect(storage.getItem(`theme`)).toBe(`dark`)
})

it("keeps an opened user and group newest first, and pins their rows' ids first in the recent picks", () => {
  const storage = memoryStorage()
  storage.setItem(PALETTE_RECENT_KEY, `["action-go-users"]`)
  const recent = createPaletteRecent(storage)

  recent.open(ADA)
  recent.open(TEAM)

  expect(recent.opened.value).toEqual([TEAM, ADA])
  expect(JSON.parse(storage.getItem(PALETTE_RECENT_KEY)!)).toEqual([
    `group:${TEAM.id}`,
    `user:42`,
    `action-go-users`,
  ])
  expect(createPaletteRecent(storage).opened.value).toEqual([TEAM, ADA])
})

it("keeps a record opened twice once, moved first, with its latest name", () => {
  const recent = createPaletteRecent(memoryStorage())
  recent.open(ADA)
  recent.open(TEAM)

  recent.open({ ...ADA, name: `Ada King` })

  expect(recent.opened.value).toEqual([{ ...ADA, name: `Ada King` }, TEAM])
})

it(`drops the oldest record past ${OPENED_KEPT}`, () => {
  const recent = createPaletteRecent(memoryStorage())
  for (let id = 1; id <= OPENED_KEPT + 1; id++) {
    recent.open({ kind: `user`, id: `${id}`, name: `Person ${id}` })
  }

  expect(recent.opened.value).toHaveLength(OPENED_KEPT)
  expect(recent.opened.value[0].id).toBe(`${OPENED_KEPT + 1}`)
  expect(recent.opened.value.some((record) => record.id === `1`)).toBe(false)
})

it("reads no records from malformed storage, skipping entries that are not records", () => {
  for (const raw of [`not json`, `{"kind":"user"}`, `null`, `42`]) {
    const storage = memoryStorage()
    storage.setItem(PALETTE_OPENED_KEY, raw)
    expect(createPaletteRecent(storage).opened.value).toEqual([])
  }
  const storage = memoryStorage()
  storage.setItem(
    PALETTE_OPENED_KEY,
    JSON.stringify([null, 7, { kind: `note`, id: `1`, name: `x` }, { kind: `user`, id: 1 }, ADA]),
  )
  expect(createPaletteRecent(storage).opened.value).toEqual([ADA])
})

it("keeps working without throwing where storage refuses every call", () => {
  const blocked: KeyValueStore = {
    getItem: () => {
      throw new DOMException(`blocked`, `SecurityError`)
    },
    setItem: () => {
      throw new DOMException(`blocked`, `SecurityError`)
    },
    removeItem: () => {
      throw new DOMException(`blocked`, `SecurityError`)
    },
  }
  const recent = createPaletteRecent(blocked)
  expect(recent.opened.value).toEqual([])

  recent.open(ADA)
  expect(recent.opened.value).toEqual([ADA])

  recent.forget()
  expect(recent.opened.value).toEqual([])
})
