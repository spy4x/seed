import { expect } from "@std/expect"
import { afterEach, describe, it } from "@std/testing/bdd"
import type { User } from "@domain/identity"
import {
  ClientTransport,
  createJsonCodec,
  PersistentCursorStore,
  RealtimeRequestError,
} from "@spy4x/realtime"
import {
  drainMicrotasks,
  FakeClock,
  FakeSocketFactory,
  MemoryKeyValueStore,
} from "@spy4x/realtime/testing"
// The codec of the app deployed before the server's error frames gained `reason` and `fields`
// (#430): the one a page left open across that deploy still runs.
import { createJsonCodec as createJsonCodec1910 } from "jsr:@spy4x/realtime@1.91.0/protocol"
import {
  connectionDisplay,
  sessionGate,
  UPDATE_CHECK_GAP_MS,
  updateCheck,
  versionAwareCodec,
} from "./index.ts"
import { sessionState } from "../state/session.ts"

const realFetch = globalThis.fetch

function meAnswers(status: number, body: unknown) {
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    )
}

afterEach(() => {
  globalThis.fetch = realFetch
  sessionState.value = { ...sessionState.value, user: null, isMfaRequired: false, wsStatus: "idle" }
})

describe("sessionGate", () => {
  it("lets the socket reconnect while the cookie still belongs to the page's user", async () => {
    meAnswers(200, { id: 1 })
    expect((await sessionGate(1)()).allowed).toBe(true)
  })

  it("refuses the reconnect and signs the page out when the cookie now belongs to another user", async () => {
    sessionState.value = { ...sessionState.value, user: { id: 1 } as User }
    meAnswers(200, { id: 2 })
    expect((await sessionGate(1)()).allowed).toBe(false)
    expect(sessionState.value.user).toBeNull()
  })

  it("lets the socket try again when the server cannot be reached", async () => {
    globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"))
    expect((await sessionGate(1)()).allowed).toBe(true)
  })
})

describe("connectionDisplay", () => {
  it("shows the socket's own status when the page did not just return", () => {
    expect(connectionDisplay({ wsStatus: "closed", wsResume: "none" })).toBe("closed")
    expect(connectionDisplay({ wsStatus: "open", wsResume: "none" })).toBe("open")
  })

  it("shows no disconnect while the page has just returned and the socket is not open yet", () => {
    expect(connectionDisplay({ wsStatus: "closed", wsResume: "quiet" })).toBe("open")
    expect(connectionDisplay({ wsStatus: "connecting", wsResume: "quiet" })).toBe("open")
  })

  it("shows Reconnecting once the reconnect took longer than the quiet period", () => {
    expect(connectionDisplay({ wsStatus: "closed", wsResume: "slow" })).toBe("reconnecting")
  })

  it("shows open as soon as the socket is open, whatever the resume state", () => {
    expect(connectionDisplay({ wsStatus: "open", wsResume: "slow" })).toBe("open")
  })
})

/** A socket answering one command with a refusal that carries `reason`, as the server sends now. */
async function refuseOneCommand(codec: ReturnType<typeof createJsonCodec>) {
  const factory = new FakeSocketFactory()
  const clock = new FakeClock()
  const transport = new ClientTransport({
    url: "wss://app.example.test/api/ws",
    socketFactory: (url) => factory.open(url),
    clock,
    cursors: new PersistentCursorStore({ storage: new MemoryKeyValueStore(), clock }),
    pull: () => {},
    codec,
  })
  transport.connect()
  await drainMicrotasks()
  const frames = () => factory.latest.frames() as { kind: string; id: string }[]
  const sync = frames().find((frame) => frame.kind === "client.sync")!
  factory.latest.receive(JSON.stringify({ kind: "server.ack", ackId: sync.id }))
  await drainMicrotasks()
  let refusal: unknown = null
  transport.command("note.create", {}).catch((error) => refusal = error)
  await drainMicrotasks()
  const request = frames().find((frame) => frame.kind === "client.command")!
  factory.latest.receive(JSON.stringify({
    kind: "server.error",
    requestId: request.id,
    code: "forbidden",
    message: "Not allowed",
    reason: "FORBIDDEN",
  }))
  await drainMicrotasks()
  transport.stop()
  return refusal
}

describe("versionAwareCodec", () => {
  it("asks for the new version when a page from before #430 gets a refusal it cannot read", async () => {
    let checks = 0
    const refusal = await refuseOneCommand(versionAwareCodec(createJsonCodec1910(), () => checks++))
    expect(refusal).toBeNull()
    expect(checks).toBe(1)
  })

  it("shows the refusal and asks for nothing when the page speaks the server's protocol", async () => {
    let checks = 0
    const refusal = await refuseOneCommand(versionAwareCodec(createJsonCodec(), () => checks++))
    expect(refusal).toBeInstanceOf(RealtimeRequestError)
    expect((refusal as RealtimeRequestError).reason).toBe("FORBIDDEN")
    expect(checks).toBe(0)
  })
})

describe("updateCheck", () => {
  it("looks for a newer service worker once per gap, however many frames fail", () => {
    let time = 1_000
    let updates = 0
    const check = updateCheck(() => Promise.resolve(updates++), () => time)
    check()
    check()
    expect(updates).toBe(1)
    time += UPDATE_CHECK_GAP_MS
    check()
    expect(updates).toBe(2)
  })
})
