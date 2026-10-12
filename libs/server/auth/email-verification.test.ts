import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { MemoryAuthStore } from "@spy4x/server/auth/memory-store"
import { EmailCodeError } from "@spy4x/server/auth/email-code"
import { PASSWORD_METHOD } from "@spy4x/server/auth/password"
import {
  proveEmailCode,
  provenAddressOwner,
  readEmailStatus,
  sendEmailCode,
} from "./email-verification.ts"

/** A store with one unproven address account (`ann`), one proven (`bea`) and one username one. */
async function storeWithAccounts() {
  const store = new MemoryAuthStore()
  const key = (subject: string, email: string | null, provenAt: Date | null) => ({
    method: PASSWORD_METHOD,
    subject,
    email,
    secret: "hash",
    provenAt,
  })
  const ann = await store.createUserWithKey(key("ann@example.com", "ann@example.com", null))
  const bea = await store.createUserWithKey(key("bea@example.com", "bea@example.com", new Date()))
  const old = await store.createUserWithKey(key("olduser", null, null))
  return { store, ann: ann.user.id, bea: bea.user.id, old: old.user.id }
}

const noChange = { find: () => Promise.resolve(null) }

describe("readEmailStatus", () => {
  it("says an account's address is unproven until a code or a reset proves it", async () => {
    const { store, ann, bea } = await storeWithAccounts()

    expect(await readEmailStatus(noChange, store, ann)).toEqual({
      email: "ann@example.com",
      proven: false,
      pending: null,
    })
    expect((await readEmailStatus(noChange, store, bea)).proven).toBe(true)
  })

  it("gives a username account no address, so there is nothing to prove", async () => {
    const { store, old } = await storeWithAccounts()

    expect(await readEmailStatus(noChange, store, old)).toEqual({
      email: null,
      proven: false,
      pending: null,
    })
  })

  it("gives an account made with a provider the address the provider proved", async () => {
    const store = new MemoryAuthStore()
    const { user } = await store.createUserWithKey({
      method: "oauth:google",
      subject: "google-1",
      email: "gia@example.com",
      secret: null,
      provenAt: new Date(),
    })

    expect(await readEmailStatus(noChange, store, user.id)).toEqual({
      email: "gia@example.com",
      proven: true,
      pending: null,
    })
  })

  it("keeps the password's address when a provider with another one is linked", async () => {
    const { store, ann, old } = await storeWithAccounts()
    const linked = (userId: number, subject: string) =>
      store.addKey(userId, {
        method: "oauth:github",
        subject,
        email: `${subject}@example.com`,
        secret: null,
        provenAt: new Date(),
      })
    await linked(ann, "hub-ann")
    await linked(old, "hub-old")

    expect((await readEmailStatus(noChange, store, ann)).email).toBe("ann@example.com")
    expect((await readEmailStatus(noChange, store, old)).email).toBe(null)
  })

  it("shows no address a provider did not prove", async () => {
    const store = new MemoryAuthStore()
    const { user } = await store.createUserWithKey({
      method: "oauth:github",
      subject: "hub-2",
      email: "claimed@example.com",
      secret: null,
      provenAt: null,
    })

    expect((await readEmailStatus(noChange, store, user.id)).email).toBe(null)
  })

  it("carries the address a change waits for, next to the one the account keeps", async () => {
    const { store, bea } = await storeWithAccounts()
    const changes = {
      find: (userId: number) => Promise.resolve(userId === bea ? "b@x.test" : null),
    }

    expect(await readEmailStatus(changes, store, bea)).toEqual({
      email: "bea@example.com",
      proven: true,
      pending: "b@x.test",
    })
  })
})

describe("provenAddressOwner", () => {
  it("names the owner of a proven address, matched after normalising", async () => {
    const { store, bea } = await storeWithAccounts()

    expect(await provenAddressOwner(store, "  BEA@example.com ")).toBe(bea)
  })

  it("names nobody for an address that is only claimed, not proven", async () => {
    const { store } = await storeWithAccounts()

    expect(await provenAddressOwner(store, "ann@example.com")).toBe(null)
    expect(await provenAddressOwner(store, "nobody@example.com")).toBe(null)
    expect(await provenAddressOwner(store, "olduser")).toBe(null)
  })
})

describe("sendEmailCode and proveEmailCode", () => {
  it("hands the sender a code that proves the address once, for the user who has it", async () => {
    const { store, ann } = await storeWithAccounts()
    const sent: { email: string; code: string }[] = []

    await sendEmailCode(store, ann, "Ann@Example.com", (email, code) => {
      sent.push({ email, code })
      return Promise.resolve()
    })

    expect(sent.map(({ email }) => email)).toEqual(["ann@example.com"])
    await expect(proveEmailCode(store, ann, "ann@example.com", "wrong-code")).rejects.toThrow(
      EmailCodeError,
    )
    await proveEmailCode(store, ann, "ann@example.com", sent[0].code)
    expect(await provenAddressOwner(store, "ann@example.com")).toBe(ann)
    await expect(proveEmailCode(store, ann, "ann@example.com", sent[0].code)).rejects.toThrow(
      EmailCodeError,
    )
  })

  it("keeps a code to one user, so another user cannot prove the address with it", async () => {
    const { store, ann, bea } = await storeWithAccounts()
    let code = ""
    await sendEmailCode(store, ann, "ann@example.com", (_email, sent) => {
      code = sent
      return Promise.resolve()
    })

    await expect(proveEmailCode(store, bea, "ann@example.com", code)).rejects.toThrow(
      EmailCodeError,
    )
    expect(await provenAddressOwner(store, "ann@example.com")).toBe(null)
  })

  it("passes a failed send on to the caller, so the job is retried", async () => {
    const { store, ann } = await storeWithAccounts()

    await expect(
      sendEmailCode(store, ann, "ann@example.com", () => Promise.reject(new Error("smtp down"))),
    ).rejects.toThrow("smtp down")
  })
})
