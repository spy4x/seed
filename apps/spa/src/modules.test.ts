import { expect } from "@std/expect"
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd"
import { ConnectionLostError } from "@spy4x/realtime"
import {
  callCommand,
  callQuery,
  configureModules,
  connectionDisplay,
  moduleSwitches,
  offlineTransportFor,
  startModules,
  stopChanges,
} from "./modules.ts"
import { installLocalStorage } from "@spy4x/platform/browser/testing"
import { sessionState, type SessionUser } from "./state/session.ts"

const realFetch = globalThis.fetch
const globals = globalThis as { document?: unknown; location?: unknown; WebSocket?: unknown }
const realWebSocket = globals.WebSocket
const signedOut = sessionState.value

/** The page as the sync runner reads it: visible, and able to hide and show itself. */
function visiblePage() {
  const listeners = new Set<() => void>()
  const page = {
    visibilityState: "visible",
    addEventListener: (_type: string, listener: () => void) => void listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => void listeners.delete(listener),
    /** Hides or shows the tab, as the browser does, and tells whoever listens. */
    show(visible: boolean) {
      page.visibilityState = visible ? "visible" : "hidden"
      for (const listener of [...listeners]) listener()
    },
  }
  globals.document = page
  return page
}

/** A browser socket that opens and drops only when the test says so. */
class FakeWebSocket {
  static opened: FakeWebSocket[] = []
  readyState = 0
  #listeners = new Map<string, Set<(event: unknown) => void>>()
  constructor(readonly url: string, readonly protocols?: string | string[]) {
    FakeWebSocket.opened.push(this)
  }
  addEventListener(type: string, listener: (event: unknown) => void) {
    this.#listeners.set(type, (this.#listeners.get(type) ?? new Set()).add(listener))
  }
  removeEventListener(type: string, listener: (event: unknown) => void) {
    this.#listeners.get(type)?.delete(listener)
  }
  /** The frames the page sent, parsed. */
  sent: Record<string, unknown>[] = []
  send(data: string) {
    this.sent.push(JSON.parse(data))
  }
  close() {
    this.readyState = 3
  }
  #emit(type: string, event: unknown) {
    for (const listener of [...this.#listeners.get(type) ?? []]) listener(event)
  }
  /** The server accepted the socket. */
  accept() {
    this.readyState = 1
    this.#emit("open", {})
  }
  /** The server sent `frame`. */
  receive(frame: unknown) {
    this.#emit("message", { data: JSON.stringify(frame) })
  }
  /** The network dropped the socket. */
  drop() {
    this.readyState = 3
    this.#emit("close", { code: 1006, reason: "", wasClean: false })
  }
}

/** A page that can open sockets, all of them {@link FakeWebSocket}s. */
function pageWithSockets() {
  FakeWebSocket.opened = []
  globals.location = { protocol: "https:", host: "app.example.com" }
  globals.WebSocket = FakeWebSocket
  return visiblePage()
}

/** Waits for `done`, one macrotask at a time; fails rather than wait for ever. */
async function until(done: () => boolean): Promise<void> {
  for (let turns = 0; !done(); turns++) {
    if (turns > 200) throw new Error("the condition never held")
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

/** Lets `ms` pass, timers included. */
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// The modules read who is remembered and whose copies are owed a deletion: nobody, in every test.
let restoreLocalStorage = () => {}
beforeEach(() => {
  restoreLocalStorage = installLocalStorage().restore
})

afterEach(() => {
  restoreLocalStorage()
  stopChanges()
  configureModules({})
  sessionState.value = signedOut
  globalThis.fetch = realFetch
  delete globals.document
  delete globals.location
  globals.WebSocket = realWebSocket
})

describe("the module switches", () => {
  it("run both modules unless the configuration says false", () => {
    configureModules({})
    const byDefault = { ...moduleSwitches() }
    configureModules({ realtime: false, offline: false })
    const off = { ...moduleSwitches() }
    configureModules({ realtime: true, offline: true })

    expect(byDefault).toEqual({ realtime: true, offline: true })
    expect(off).toEqual({ realtime: false, offline: false })
    expect(moduleSwitches()).toEqual({ realtime: true, offline: true })
  })

  it("show the browser's network, not the socket, for a page with no socket", () => {
    const state = { wsStatus: "closed", wsResume: "none" } as const
    const withSocket = connectionDisplay(state)
    configureModules({ realtime: false })

    expect([withSocket, connectionDisplay(state)]).toEqual(["closed", "open"])
  })

  it("follow the browser's offline and online events on a started page with no socket, until it stops", () => {
    visiblePage()
    configureModules({ realtime: false, offline: false })
    const state = { wsStatus: "open", wsResume: "none" } as const
    startModules(7, { pull: () => {}, check: () => Promise.resolve() })

    dispatchEvent(new Event("offline"))
    const offline = connectionDisplay(state)
    dispatchEvent(new Event("online"))
    const online = connectionDisplay(state)
    stopChanges()
    dispatchEvent(new Event("offline"))

    expect([offline, online, connectionDisplay(state)]).toEqual(["closed", "open", "open"])
  })
})

describe("a page with no socket", () => {
  it("runs the pull at the start and the cheap check after its own write, and never opens a socket", async () => {
    visiblePage()
    configureModules({ realtime: false, offline: false })
    const urls: string[] = []
    globalThis.fetch = ((url: string) => {
      urls.push(url)
      return Promise.resolve(Response.json({ result: { created: true } }))
    }) as unknown as typeof fetch
    const checks: boolean[] = []

    startModules(7, {
      pull: () => Promise.reject(new Error("the hints' pull belongs to the socket")),
      check: (full) => Promise.resolve(void checks.push(full)),
    })
    await until(() => checks.length === 1)
    const result = await callCommand("note.create", { title: "A" })
    await until(() => checks.length === 2)

    expect(checks).toEqual([true, false])
    expect(result).toEqual({ created: true })
    expect(urls).toEqual(["/api/call/note.create"])
  })

  it("checks again on a timer, and the timer's check is the cheap one", async () => {
    visiblePage()
    configureModules({ realtime: false, offline: false })
    const checks: boolean[] = []

    startModules(7, {
      pull: () => {},
      check: (full) => Promise.resolve(void checks.push(full)),
    }, { pollIntervalMs: 2 })
    await until(() => checks.length >= 3)

    expect(checks.slice(0, 3)).toEqual([true, false, false])
  })

  it("reads nothing while the tab is hidden, and pulls when it is shown again", async () => {
    const page = visiblePage()
    configureModules({ realtime: false, offline: false })
    const checks: boolean[] = []
    startModules(7, {
      pull: () => {},
      check: (full) => Promise.resolve(void checks.push(full)),
    }, { pollIntervalMs: 2 })
    await until(() => checks.length >= 2)

    const whenHidden = checks.length
    page.show(false)
    await pause(30)
    const afterHidden = checks.length
    page.show(true)
    await until(() => checks.length > afterHidden)

    expect(afterHidden).toBe(whenHidden)
    expect(checks[afterHidden]).toBe(true)
  })

  it("sends every try of a command as the user who started it, whoever signs in meanwhile", async () => {
    visiblePage()
    configureModules({ realtime: false, offline: false })
    const sentAs: (string | null)[] = []
    globalThis.fetch = ((_url: string, init: RequestInit) => {
      sentAs.push(new Headers(init.headers).get("x-realtime-user"))
      // The first try's outcome is unknown; the second is answered.
      return sentAs.length === 1
        ? Promise.reject(new TypeError("network down"))
        : Promise.resolve(Response.json({ result: { created: true } }))
    }) as unknown as typeof fetch
    const reads = { pull: () => {}, check: () => Promise.resolve() }
    startModules(7, reads)

    await callCommand("note.create", { title: "A" }, {
      // Between the tries user 7 leaves and user 8 signs in on the same page.
      sleep: () => {
        stopChanges()
        startModules(8, reads)
        return Promise.resolve()
      },
    })

    expect(sentAs).toEqual(["7", "7"])
  })

  it("fails a call as a dropped connection once nobody is signed in", async () => {
    visiblePage()
    configureModules({ realtime: false, offline: false })
    startModules(7, { pull: () => {}, check: () => Promise.resolve() })
    stopChanges()

    await expect(callQuery("group.list", undefined, { attempts: 1 })).rejects.toBeInstanceOf(
      ConnectionLostError,
    )
  })
})

describe("the queue of writes", () => {
  const user = (id: number) => ({ id }) as SessionUser
  const port = { command: () => Promise.resolve(), query: () => Promise.resolve() }

  it("may be sent only while its user is the one signed in on a started page", () => {
    visiblePage()
    configureModules({ realtime: false, offline: false })
    const transport = offlineTransportFor(7, port)
    const answers: boolean[] = []
    const reads = { pull: () => {}, check: () => Promise.resolve() }

    sessionState.value = { ...signedOut, user: user(7) }
    answers.push(transport.canSend()) // signed in, but the modules are not started
    startModules(7, reads)
    answers.push(transport.canSend())
    sessionState.value = { ...signedOut, user: user(7), isMfaRequired: true }
    answers.push(transport.canSend()) // the second factor is owed
    sessionState.value = { ...signedOut, user: user(8) }
    answers.push(transport.canSend()) // the cookie's user changed under the page
    startModules(8, reads)
    answers.push(transport.canSend()) // the page restarted for the other user

    expect(answers).toEqual([false, true, false, false, false])
    expect(transport.calls).toBe(port)
  })
})

describe("a page whose socket module is on", () => {
  const checksOf = (checks: boolean[]) => ({
    pull: () => {},
    check: (full: boolean) => Promise.resolve(void checks.push(full)),
  })

  it("opens its socket naming the page's user as a subprotocol", () => {
    pageWithSockets()
    configureModules({ realtime: true, offline: false })

    startModules(7, checksOf([]))

    expect(FakeWebSocket.opened.map((socket) => [socket.url, socket.protocols])).toEqual([
      ["wss://app.example.com/api/ws", ["user.7"]],
    ])
  })

  it("sends the start-up pull's call over the socket once it opens, not over HTTP beside it", async () => {
    pageWithSockets()
    configureModules({ realtime: true, offline: false })
    const overHttp: string[] = []
    globalThis.fetch = ((input: string | URL | Request) => {
      overHttp.push(String(input instanceof Request ? input.url : input))
      return Promise.resolve(Response.json({ result: { groups: ["over HTTP"] } }))
    }) as typeof fetch
    let answer: Promise<unknown> | undefined
    // The start-up pull makes the page's first call, in the same turn as the start.
    const reads = {
      pull: () => {},
      check: async () => void await (answer ??= callQuery("group.list", {})),
    }

    startModules(7, reads)
    const socket = FakeWebSocket.opened[0]
    await pause(5)
    socket.accept()
    await until(() =>
      socket.sent.some((frame) => frame.name === "group.list") || overHttp.length > 0
    )
    const frame = socket.sent.find((sent) => sent.name === "group.list")
    socket.receive({ kind: "server.result", requestId: frame?.id, payload: { groups: [] } })

    expect(await answer).toEqual({ groups: [] })
    expect(overHttp).toEqual([])
  })

  it("checks on the timer while the socket is not open, stops once it opens, and starts again when it drops", async () => {
    pageWithSockets()
    configureModules({ realtime: true, offline: false })
    globalThis.fetch = (() => Promise.resolve(Response.json({ id: 7 }))) as typeof fetch
    const checks: boolean[] = []

    startModules(7, checksOf(checks), { pollIntervalMs: 2 })
    // The socket is blocked: it stays connecting, and the page keeps itself up to date.
    await until(() => checks.length >= 3)
    const whileBlocked = checks.slice(0, 3)

    const whenOpen = checks.length
    FakeWebSocket.opened[0].accept()
    await pause(30)
    const afterOpen = checks.length

    FakeWebSocket.opened[0].drop()
    await until(() => checks.length >= afterOpen + 2)

    expect(whileBlocked).toEqual([true, false, false])
    expect(afterOpen).toBe(whenOpen)
  })
})
