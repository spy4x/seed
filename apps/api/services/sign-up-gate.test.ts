import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { sha256Hex } from "@spy4x/platform/tokens"
import type { InvitationLookup } from "@server/groups/postgres-invitation-repository.ts"
import { signUpAllowed } from "./sign-up-gate.ts"

const TOKEN = `a`.repeat(43)

/** A store holding one working invitation, found only by the hash of {@link TOKEN}. */
function storeWith(email: string | null) {
  const asked: InvitationLookup[] = []
  return {
    asked,
    async usable(ref: InvitationLookup) {
      asked.push(ref)
      return "tokenHash" in ref && ref.tokenHash === await sha256Hex(TOKEN) ? { email } : null
    },
  }
}

describe(`signUpAllowed`, () => {
  it(`lets anyone in on an open server, without looking up an invitation`, async () => {
    const store = storeWith(`ada@example.com`)
    expect(await signUpAllowed(`open`, store, null, `eve@example.com`)).toBe(true)
    expect(store.asked).toEqual([])
  })

  it(`refuses a sign-up with no invitation where sign-up is by invitation`, async () => {
    expect(await signUpAllowed(`invite`, storeWith(null), null, `ada@example.com`)).toBe(false)
    expect(await signUpAllowed(`invite`, storeWith(null), ``, `ada@example.com`)).toBe(false)
  })

  it(`admits the address an invitation names, whatever its case and spaces`, async () => {
    const store = storeWith(`ada@example.com`)
    expect(await signUpAllowed(`invite`, store, TOKEN, ` Ada@Example.COM `)).toBe(true)
  })

  it(`refuses another address, or none, for an invitation tied to an address`, async () => {
    const store = storeWith(`ada@example.com`)
    expect(await signUpAllowed(`invite`, store, TOKEN, `eve@example.com`)).toBe(false)
    expect(await signUpAllowed(`invite`, store, TOKEN, null)).toBe(false)
  })

  it(`admits any address, or none, with a link invitation`, async () => {
    const store = storeWith(null)
    expect(await signUpAllowed(`invite`, store, TOKEN, `eve@example.com`)).toBe(true)
    expect(await signUpAllowed(`invite`, store, TOKEN, null)).toBe(true)
  })

  it(`refuses a token the store does not find working, and looks it up by its hash`, async () => {
    const store = storeWith(null)
    expect(await signUpAllowed(`invite`, store, `b`.repeat(43), `ada@example.com`)).toBe(false)
    expect(store.asked).toEqual([{ tokenHash: await sha256Hex(`b`.repeat(43)) }])
  })
})
