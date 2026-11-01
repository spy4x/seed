/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { MemoryAuthStore } from "@spy4x/server/auth/memory-store"
import { PASSWORD_METHOD } from "@spy4x/server/auth/password"
import type { AppDbBase } from "../../api/services/db-base.ts"
import { prove } from "./seed.ts"

/** A store with one proven and one unproven address, recording every key it is asked to prove. */
async function storeWithAddresses() {
  const store = new MemoryAuthStore()
  const proved: number[] = []
  const proveKey = store.proveKey.bind(store)
  store.proveKey = (keyId, now) => {
    proved.push(keyId)
    return proveKey(keyId, now)
  }
  const key = (email: string, provenAt: Date | null) => ({
    method: PASSWORD_METHOD,
    subject: email,
    email,
    secret: "hash",
    provenAt,
  })
  const proven = await store.createUserWithKey(key("bea@example.com", new Date("2026-10-01")))
  const unproven = await store.createUserWithKey(key("ann@example.com", null))
  const db = { authStore: store } as unknown as AppDbBase
  return { db, store, proved, provenKey: proven.key.id, unprovenKey: unproven.key.id }
}

Deno.test("the seed proves an address that is not proven yet", async () => {
  const { db, store, proved, unprovenKey } = await storeWithAddresses()

  await prove(db, "ann@example.com")

  expect(proved).toEqual([unprovenKey])
  expect((await store.findKey(PASSWORD_METHOD, "ann@example.com"))?.provenAt).not.toBeNull()
})

Deno.test("the seed does not prove again an address that is proven already, nor one with no account", async () => {
  const { db, proved } = await storeWithAddresses()

  await prove(db, "bea@example.com")
  await prove(db, "nobody@example.com")

  expect(proved).toEqual([])
})
