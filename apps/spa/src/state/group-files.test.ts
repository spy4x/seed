import { expect } from "@std/expect"
import { afterEach, describe, it } from "@std/testing/bdd"
import type { User } from "@domain/identity"
import { GROUP_IMPORT_MAX_BYTES } from "@domain/groups"
import {
  createGroupExportStore,
  createGroupImportStore,
  type GroupFilePorts,
} from "./group-files.ts"
import { sessionState } from "./session.ts"

const summary = {
  name: "Family",
  parts: [
    { kind: "notes", count: 2, one: "note", other: "notes" },
    { kind: "tags", count: 1, one: "tag", other: "tags" },
  ],
}
const FILE_TEXT = `{"format":"seed.group-export","version":1,"aggregates":{"notes":[{},{},{}]}}`

interface Sent {
  method: string
  url: string
  headers: Headers
  body: string | undefined
}

/** A fake API answering `routes["METHOD url"]` in turn; every request is recorded. */
function harness(routes: Record<string, [number, unknown] | "offline">) {
  const sent: Sent[] = []
  const saved: { filename: string; text: string }[] = []
  const ports: GroupFilePorts = {
    fetch: (url, init) => {
      const method = init?.method ?? "GET"
      sent.push({ method, url, headers: new Headers(init?.headers), body: init?.body as string })
      const route = routes[`${method} ${url}`] ?? [404, { error: { message: "No route" } }]
      if (route === "offline") return Promise.reject(new TypeError("Failed to fetch"))
      const [status, body] = route
      const headers = status === 200 && url.endsWith("/export")
        ? { "content-disposition": `attachment; filename="family-2026-10-21.json"` }
        : undefined
      return Promise.resolve(
        new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers }),
      )
    },
    save: async (response, filename) => void saved.push({ filename, text: await response.text() }),
  }
  return { ports, sent, saved }
}

function file(text = FILE_TEXT): File {
  return new File([text], "family.json", { type: "application/json" })
}

describe("group export store", () => {
  afterEach(() => {
    sessionState.value = { ...sessionState.value, user: null }
  })

  it("saves the owner's file under the name the server gave, as the page's user", async () => {
    sessionState.value = { ...sessionState.value, user: { id: 7 } as User }
    const { ports, sent, saved } = harness({ "GET /api/groups/g-1/export": [200, `{"a":1}`] })
    const store = createGroupExportStore(ports)
    expect(await store.download("g-1")).toBe(true)
    expect(saved).toEqual([{ filename: "family-2026-10-21.json", text: `{"a":1}` }])
    expect(sent[0].headers.get("x-realtime-user")).toBe("7")
    expect(store.exporting.value).toBe(null)
    expect(store.failed.value).toBe(null)
  })

  it("marks the group's export as failed when the server refuses or the network drops", async () => {
    const refused = createGroupExportStore(
      harness({ "GET /api/groups/g-1/export": [403, { error: { code: "ROLE_INSUFFICIENT" } }] })
        .ports,
    )
    expect(await refused.download("g-1")).toBe(false)
    expect(refused.failed.value).toBe("g-1")
    const dropped = harness({ "GET /api/groups/g-1/export": "offline" })
    const offline = createGroupExportStore(dropped.ports)
    expect(await offline.download("g-1")).toBe(false)
    expect(offline.failed.value).toBe("g-1")
    expect(dropped.saved).toEqual([])
  })
})

describe("group import store", () => {
  it("checks a chosen file as it is and prefills the name from it", async () => {
    const { ports, sent } = harness({ "POST /api/groups/import/check": [200, summary] })
    const store = createGroupImportStore(ports)
    await store.choose(file())
    expect(sent[0].body).toBe(FILE_TEXT)
    expect(store.state.value).toEqual({ step: "checked", summary })
    expect(store.name.value).toBe("Family")
  })

  it("refuses a file over the size limit without sending it", async () => {
    const { ports, sent } = harness({})
    const store = createGroupImportStore(ports)
    await store.choose(file(" ".repeat(GROUP_IMPORT_MAX_BYTES + 1)))
    expect(sent).toEqual([])
    expect(store.state.value).toEqual({
      step: "refused",
      problems: [{ kind: "too_large", maxBytes: GROUP_IMPORT_MAX_BYTES }],
      total: 1,
    })
  })

  it("shows the server's problems, a plan refusal with the file's notes, and a check that did not answer", async () => {
    const problems = [{ kind: "newer_version" }]
    const refused = createGroupImportStore(
      harness({
        "POST /api/groups/import/check": [422, {
          error: {
            code: "bad_request",
            message: "The file cannot be imported",
            reason: "IMPORT_REFUSED",
            details: { problems, total: 1 },
          },
        }],
      }).ports,
    )
    await refused.choose(file())
    expect(refused.state.value).toEqual({ step: "refused", problems, total: 1 })

    const plan = createGroupImportStore(
      harness({
        "POST /api/groups/import/check": [402, {
          error: {
            code: "forbidden",
            message: "The group has reached its plan's limit",
            reason: "PLAN_LIMIT_REACHED",
            details: {
              code: "PLAN_LIMIT_REACHED",
              entitlement: "maxNotes",
              limit: 2,
              canUpgrade: true,
            },
          },
        }],
      }).ports,
    )
    await plan.choose(file())
    expect(plan.state.value).toMatchObject({
      step: "plan",
      refusal: { entitlement: "maxNotes", limit: 2 },
      notes: 3,
    })

    const offline = createGroupImportStore(
      harness({ "POST /api/groups/import/check": "offline" }).ports,
    )
    await offline.choose(file())
    expect(offline.state.value).toEqual({ step: "unchecked" })
  })

  it("ignores the answer for a file the person replaced", async () => {
    let answer: (response: Response) => void = () => {}
    const ports: GroupFilePorts = {
      fetch: () => new Promise((resolve) => (answer = resolve)),
      save: () => Promise.resolve(),
    }
    const store = createGroupImportStore(ports)
    const first = store.choose(file())
    await new Promise((resolve) => setTimeout(resolve, 0))
    store.reset()
    answer(new Response(JSON.stringify(summary), { status: 200 }))
    await first
    expect(store.state.value).toEqual({ step: "choose" })
  })

  it("imports with the name given and the same key on a retry of the same file", async () => {
    const result = { group: { id: "g-2", name: "Ours" }, parts: summary.parts }
    let fail = true
    const { ports, sent } = harness({ "POST /api/groups/import/check": [200, summary] })
    const store = createGroupImportStore({
      ...ports,
      fetch: (url, init) => {
        if (url !== "/api/groups/import") return ports.fetch!(url, init)
        sent.push({
          method: "POST",
          url,
          headers: new Headers(init?.headers),
          body: init?.body as string,
        })
        if (fail) return Promise.reject(new TypeError("Failed to fetch"))
        return Promise.resolve(new Response(JSON.stringify(result), { status: 201 }))
      },
    })
    await store.choose(file())
    store.name.value = "Ours"
    expect(await store.importNow()).toBe(null)
    expect(store.importFailed.value).toBe(true)
    fail = false
    expect(await store.importNow()).toEqual(result)
    const [firstTry, retry] = sent.filter((request) => request.url === "/api/groups/import")
    expect(JSON.parse(retry.body!)).toEqual({ name: "Ours", file: JSON.parse(FILE_TEXT) })
    expect(retry.headers.get("idempotency-key")).toBe(firstTry.headers.get("idempotency-key"))
    expect(retry.headers.get("idempotency-key")?.[14]).toBe("7")
    expect(store.importFailed.value).toBe(false)
  })

  it("starts over on Choose another file, with a fresh picker", async () => {
    const store = createGroupImportStore(
      harness({ "POST /api/groups/import/check": [200, summary] }).ports,
    )
    await store.choose(file())
    store.reset()
    expect(store.state.value).toEqual({ step: "choose" })
    expect(store.name.value).toBe("")
    expect(store.attempt.value).toBe(1)
    expect(await store.importNow()).toBe(null)
  })
})
