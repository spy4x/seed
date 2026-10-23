import { expect } from "@std/expect"
import { afterEach, describe, it } from "@std/testing/bdd"
import type { SignInMethod } from "@domain/identity"
import type { PasskeyBrowser } from "@spy4x/platform/browser/passkey"
import {
  createSignInMethodsStore,
  listProviders,
  PASSKEY_NOT_SAVED,
  PASSKEY_ON_THIS_DEVICE,
  readPendingSignUp,
  type SignInMethodsHttp,
} from "./sign-in-methods.ts"

const password: SignInMethod = {
  id: 3,
  kind: "password",
  email: "ada@example.com",
  current: true,
  canUnlink: false,
}
const google: SignInMethod = {
  id: 8,
  kind: "google",
  email: "ada@example.com",
  current: false,
  canUnlink: true,
}

const PROOF_UNTIL = "2026-10-13T08:05:00.000Z"

/** What the server answers for a new passkey; the fake device reads none of it. */
const PASSKEY_OPTIONS = {
  rp: { id: "app.example", name: "Example" },
  user: { id: "MQ", name: "ada@example.com", displayName: "Ada" },
  challenge: "Y2hhbGxlbmdl",
  pubKeyCredParams: [{ type: "public-key" as const, alg: -7 }],
}

/** A server that holds `methods`, records each call and answers as `answers` says. */
function fakeHttp(
  methods: SignInMethod[],
  answers: Partial<SignInMethodsHttp> = {},
): SignInMethodsHttp & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    list() {
      calls.push("list")
      return answers.list?.() ?? Promise.resolve({
        ok: true,
        methods,
        available: ["github"],
        providerProofUntil: PROOF_UNTIL,
        emailLink: false,
      })
    },
    link(provider, password) {
      calls.push(password === undefined ? `link ${provider}` : `link ${provider} with ${password}`)
      return answers.link?.(provider, password) ??
        Promise.resolve({ ok: true, url: `https://provider.example/${provider}` })
    },
    unlink(methodId, password) {
      calls.push(
        password === undefined ? `unlink ${methodId}` : `unlink ${methodId} with ${password}`,
      )
      return answers.unlink?.(methodId, password) ?? Promise.resolve({ ok: true, signedOut: false })
    },
    passkeyOptions(password) {
      calls.push(password === undefined ? `passkey options` : `passkey options with ${password}`)
      return answers.passkeyOptions?.(password) ??
        Promise.resolve({ ok: true, options: PASSKEY_OPTIONS })
    },
    addPasskey(credential) {
      calls.push(`add passkey ${credential.id}`)
      return answers.addPasskey?.(credential) ??
        Promise.resolve({ ok: true, keyId: 9, name: "Chrome on Linux" })
    },
    renamePasskey(methodId, name) {
      calls.push(`rename ${methodId} to ${name}`)
      return answers.renamePasskey?.(methodId, name) ?? Promise.resolve({ ok: true, name })
    },
  }
}

describe("the sign-in methods store", () => {
  it("shows the methods and the providers still to link once the list is read", async () => {
    const store = createSignInMethodsStore(fakeHttp([password, google]))
    expect(store.methods.value).toBe(null)

    await store.load()

    expect(store.methods.value).toEqual([password, google])
    expect(store.available.value).toEqual(["github"])
    expect(store.providerProofUntil.value).toBe(PROOF_UNTIL)
    expect(store.error.value).toBe(null)
  })

  it("keeps the list shown and gives the reason when a read fails", async () => {
    let fail = false
    const http = fakeHttp([password], {
      list: () => fail ? Promise.resolve({ ok: false, error: "Too many requests" }) : undefined!,
    })
    const store = createSignInMethodsStore(http)
    await store.load()
    fail = true

    await store.load()

    expect(store.methods.value).toEqual([password])
    expect(store.loadError.value).toBe("Too many requests")
    expect(store.error.value).toBe(null)
  })

  it("tells a read that cannot reach the server apart from a failed change", async () => {
    let release: () => void = () => {}
    const http = fakeHttp([password], {
      list: () =>
        new Promise((_resolve, reject) => {
          release = () => reject(new TypeError("offline"))
        }),
    })
    const store = createSignInMethodsStore(http)

    const read = store.load()
    expect(store.loading.value).toBe(true)
    release()
    await read

    expect(store.loading.value).toBe(false)
    expect(store.methods.value).toBe(null)
    expect(store.loadError.value).toBe("")
    expect(store.error.value).toBe(null)
  })

  it("clears the read's failure once a read answers", async () => {
    let fail = true
    const http = fakeHttp([password], {
      list: () => fail ? Promise.reject(new TypeError("offline")) : undefined!,
    })
    const store = createSignInMethodsStore(http)
    await store.load()
    expect(store.loadError.value).toBe("")
    fail = false

    await store.load()

    expect(store.loadError.value).toBe(null)
    expect(store.methods.value).toEqual([password])
  })

  it("sends the browser to the provider's page to link it", async () => {
    const left: string[] = []
    const store = createSignInMethodsStore(fakeHttp([password]), (url) => void left.push(url))

    await store.link("github")

    expect(left).toEqual(["https://provider.example/github"])
    expect(store.error.value).toBe(null)
  })

  it("hands the account's password to the server with the link", async () => {
    const http = fakeHttp([password])
    const store = createSignInMethodsStore(http, () => {})

    await store.link("github", "Passw0rd!")

    expect(http.calls).toEqual(["link github with Passw0rd!"])
  })

  it("reads until when the provider sign-in confirms again after a refused link", async () => {
    let until: string | null = PROOF_UNTIL
    const http = fakeHttp([google], {
      list: () =>
        Promise.resolve({
          ok: true,
          methods: [google],
          available: [],
          providerProofUntil: until,
          emailLink: false,
        }),
      link: () => Promise.resolve({ ok: false, error: "Sign in with your provider again" }),
    })
    const store = createSignInMethodsStore(http, () => {})
    await store.load()
    until = null

    await store.link("github")

    expect(store.providerProofUntil.value).toBe(null)
    // The refusal stays shown: the read after it does not clear it.
    expect(store.error.value).toBe("Sign in with your provider again")
    expect(store.pending.value).toBe(false)
  })

  it("stays on the page with the reason when a link is refused", async () => {
    const left: string[] = []
    const http = fakeHttp([password], {
      link: () => Promise.resolve({ ok: false, error: "This sign-in method is not available." }),
    })
    const store = createSignInMethodsStore(http, (url) => void left.push(url))

    await store.link("github")

    expect(left).toHaveLength(0)
    expect(store.error.value).toBe("This sign-in method is not available.")
    expect(store.pending.value).toBe(false)
  })

  it("reads the list again after an unlink", async () => {
    const http = fakeHttp([password])
    const store = createSignInMethodsStore(http)

    expect(await store.unlink(8)).toBe("unlinked")

    expect(http.calls).toEqual(["unlink 8", "list"])
    expect(store.methods.value).toEqual([password])
    expect(store.pending.value).toBe(false)
  })

  it("says so when the unlink signed this device out, and reads nothing more", async () => {
    const http = fakeHttp([google], {
      unlink: () => Promise.resolve({ ok: true, signedOut: true }),
    })
    const store = createSignInMethodsStore(http)

    expect(await store.unlink(8)).toBe("signed-out")

    expect(http.calls).toEqual(["unlink 8"])
  })

  it("gives the server's reason when an unlink is refused, and keeps the list", async () => {
    const http = fakeHttp([google], {
      unlink: () => Promise.resolve({ ok: false, error: "This is your only way to sign in." }),
    })
    const store = createSignInMethodsStore(http)
    await store.load()

    expect(await store.unlink(8)).toBe("failed")

    expect(store.error.value).toBe("This is your only way to sign in.")
    expect(store.methods.value).toEqual([google])
    expect(http.calls).toEqual(["list", "unlink 8", "list"])
  })

  it("hands the account's password to the server with the unlink", async () => {
    const http = fakeHttp([password])
    const store = createSignInMethodsStore(http)

    expect(await store.unlink(8, "Passw0rd!")).toBe("unlinked")

    expect(http.calls).toEqual(["unlink 8 with Passw0rd!", "list"])
  })

  it("reads until when the provider sign-in confirms again after a refused unlink", async () => {
    let until: string | null = PROOF_UNTIL
    const http = fakeHttp([google], {
      list: () =>
        Promise.resolve({
          ok: true,
          methods: [google],
          available: [],
          providerProofUntil: until,
          emailLink: false,
        }),
      unlink: () => Promise.resolve({ ok: false, error: "Sign in with your provider again" }),
    })
    const store = createSignInMethodsStore(http)
    await store.load()
    until = null

    expect(await store.unlink(8)).toBe("failed")

    expect(store.providerProofUntil.value).toBe(null)
    // The refusal stays shown: the read after it does not clear it.
    expect(store.error.value).toBe("Sign in with your provider again")
    expect(store.pending.value).toBe(false)
  })

  it("reports a failure without a reason when the server cannot be reached", async () => {
    const http = fakeHttp([google], { unlink: () => Promise.reject(new TypeError("offline")) })
    const store = createSignInMethodsStore(http)

    expect(await store.unlink(8)).toBe("failed")

    expect(store.error.value).toBe("")
    expect(store.loadError.value).toBe(null)
    expect(store.pending.value).toBe(false)
  })

  it("starts no second change while one is in flight", async () => {
    let release: () => void = () => {}
    const http = fakeHttp([password, google], {
      unlink: () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, signedOut: false })
        }),
    })
    const store = createSignInMethodsStore(http, () => {})
    const first = store.unlink(8)

    expect(await store.unlink(8)).toBe("failed")
    await store.link("github")
    release()
    await first

    expect(http.calls).toEqual(["unlink 8", "list"])
  })
})

describe("what the sign-in pages read", () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  /** Makes every request answer `status` with `body`, and records the paths asked for. */
  function answers(status: number, body: unknown): string[] {
    const asked: string[] = []
    globalThis.fetch = (input) => {
      asked.push(new URL(String(input instanceof Request ? input.url : input), "http://x").pathname)
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
      )
    }
    return asked
  }

  it("lists the providers the API says are on", async () => {
    const asked = answers(200, { providers: ["google"] })

    expect(await listProviders()).toEqual(["google"])
    expect(asked).toEqual(["/api/auth/providers"])
  })

  it("shows no provider when the list cannot be read", async () => {
    answers(503, { error: "down" })
    expect(await listProviders()).toEqual([])

    globalThis.fetch = () => Promise.reject(new TypeError("offline"))
    expect(await listProviders()).toEqual([])

    answers(200, "<html>maintenance</html>")
    expect(await listProviders()).toEqual([])
  })

  it("reads the sign-up that waits, and none when the API holds none", async () => {
    const waiting = {
      provider: "google",
      email: "ada@example.com",
      expiresAt: "2026-11-04T08:10Z",
      unconfirmedAccount: false,
    }
    const asked = answers(200, { pending: waiting })
    expect(await readPendingSignUp()).toEqual(waiting)
    expect(asked).toEqual(["/api/auth/sign-up/pending"])

    answers(200, { pending: null })
    expect(await readPendingSignUp()).toBe(null)

    answers(500, { error: "down" })
    expect(await readPendingSignUp()).toBe(null)
  })
})

/** A device whose dialog answers as `answer` says: a new passkey, a closed dialog, or a refusal. */
function fakeDevice(answer: "create" | "close" | Error): PasskeyBrowser {
  return {
    PublicKeyCredential: {
      parseCreationOptionsFromJSON: (options) =>
        options as unknown as PublicKeyCredentialCreationOptions,
      parseRequestOptionsFromJSON: (options) =>
        options as unknown as PublicKeyCredentialRequestOptions,
    },
    credentials: {
      create: () => {
        if (answer instanceof Error) return Promise.reject(answer)
        if (answer === "close") {
          return Promise.reject(new DOMException("The user closed the dialog.", "NotAllowedError"))
        }
        return Promise.resolve({
          toJSON: () => ({ id: "cred-1", rawId: "cred-1", type: "public-key", response: {} }),
        })
      },
      get: () => Promise.resolve(null),
    },
  }
}

describe("adding and renaming passkeys", () => {
  it("asks the server with the password, then the device, then stores the passkey and reads the list", async () => {
    const http = fakeHttp([password])
    const store = createSignInMethodsStore(http, () => {}, { browser: fakeDevice("create") })

    await store.addPasskey("Passw0rd!")
    expect(http.calls).toEqual(["passkey options with Passw0rd!", "add passkey cred-1", "list"])
    expect(store.passkeyStatus.value).toEqual({ kind: "added", keyId: 9, name: "Chrome on Linux" })
    expect(store.pending.value).toBe(false)
    expect(store.error.value).toBe(null)
  })

  it("says nothing was added when the person closes the device's dialog", async () => {
    const http = fakeHttp([password])
    const store = createSignInMethodsStore(http, () => {}, { browser: fakeDevice("close") })

    await store.addPasskey("Passw0rd!")
    expect(http.calls).toEqual(["passkey options with Passw0rd!"])
    expect(store.passkeyStatus.value).toEqual({ kind: "cancelled" })
    expect(store.error.value).toBe(null)
  })

  it("says this device has a passkey already when the device refuses for that", async () => {
    const already = new DOMException("excluded", "InvalidStateError")
    const store = createSignInMethodsStore(fakeHttp([password]), () => {}, {
      browser: fakeDevice(already),
    })

    await store.addPasskey("Passw0rd!")
    expect(store.error.value).toBe(PASSKEY_ON_THIS_DEVICE)
    expect(store.passkeyStatus.value).toBe(null)
  })

  it("gives the server's reason when it refuses the password or the passkey", async () => {
    const refused = fakeHttp([password], {
      passkeyOptions: () => Promise.resolve({ ok: false, error: "Invalid password" }),
    })
    const store = createSignInMethodsStore(refused, () => {}, { browser: fakeDevice("create") })
    await store.addPasskey("wrong")
    expect(store.error.value).toBe("Invalid password")
    expect(store.passkeyStatus.value).toBe(null)

    const notSaved = fakeHttp([password], {
      addPasskey: () => Promise.resolve({ ok: false, error: "" }),
    })
    const second = createSignInMethodsStore(notSaved, () => {}, { browser: fakeDevice("create") })
    await second.addPasskey("Passw0rd!")
    expect(second.error.value).toBe(PASSKEY_NOT_SAVED)
  })

  it("renames a passkey in the list and clears the added notice, and rejects with the server's reason when refused", async () => {
    const passkey: SignInMethod = {
      id: 9,
      kind: "passkey",
      email: null,
      current: false,
      canUnlink: true,
      passkey: { name: "Chrome on Linux", createdAt: PROOF_UNTIL, lastUsedAt: null },
    }
    const http = fakeHttp([password, passkey])
    const store = createSignInMethodsStore(http)
    await store.load()

    store.passkeyStatus.value = { kind: "added", keyId: 9, name: "Chrome on Linux" }
    await store.renamePasskey(9, "Work laptop")
    expect(store.methods.value?.find((method) => method.id === 9)?.passkey?.name).toBe(
      "Work laptop",
    )
    // The notice that offered the rename goes with it.
    expect(store.passkeyStatus.value).toBeNull()

    const refusing = createSignInMethodsStore(fakeHttp([passkey], {
      renamePasskey: () => Promise.resolve({ ok: false, error: "Give the passkey a name" }),
    }))
    await refusing.load()
    await expect(refusing.renamePasskey(9, "x")).rejects.toThrow("Give the passkey a name")
    expect(refusing.methods.value?.[0].passkey?.name).toBe("Chrome on Linux")
  })

  it("reads the list again after a passkey sign-in confirms, and says nothing when it was cancelled", async () => {
    const http = fakeHttp([password])
    let answer: { ok: boolean; cancelled?: boolean; error?: string } = { ok: true }
    const store = createSignInMethodsStore(http, () => {}, {
      confirm: () => Promise.resolve(answer),
    })

    await store.confirmWithPasskey()
    expect(http.calls).toEqual(["list"])

    answer = { ok: false, cancelled: true }
    await store.confirmWithPasskey()
    expect(store.error.value).toBe(null)
    answer = { ok: false, error: "That passkey did not work." }
    await store.confirmWithPasskey()
    expect(store.error.value).toBe("That passkey did not work.")
    expect(http.calls).toEqual(["list"])
  })
})
