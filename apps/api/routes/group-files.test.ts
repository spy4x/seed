import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { Hono } from "hono"
import type { MiddlewareHandler } from "hono"
import type postgres from "postgres"
import { createKvStore, type RateLimitStore } from "@spy4x/platform/rate-limit"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import {
  GROUP_EXPORT_FORMAT,
  GROUP_EXPORT_VERSION,
  GROUP_IMPORT_MAX_BYTES,
  type GroupFilePorter,
  GroupRole,
} from "@domain/groups"
import { notePortable } from "@server/notes/note-portable.ts"
import { tagPortable } from "@server/tags/tag-portable.ts"
import { PostgresGroupPorter } from "@server/groups/postgres-group-porter.ts"
import type { APIContext } from "../_types.ts"
import { buildAuthData } from "../_testing/fake-auth.ts"
import {
  createGroupExportHandler,
  createGroupImportCheckHandler,
  createGroupImportHandler,
  type GroupFileHandlerDependencies,
} from "../features/groups/files.ts"
import {
  createGroupFileRateLimits,
  GROUP_EXPORTS_PER_USER,
  GROUP_IMPORTS_PER_USER,
  type GroupFileRateLimits,
} from "../features/groups/file-rate-limits.ts"
import { createGroupFilesRoute } from "./group-files.ts"
import { apiError } from "../_testing/api-error.ts"

const GROUP_ID = uuidV7()
const OWNER = 7
const at = "2026-10-01T09:00:00.000Z"
const sameOrigin = {
  "content-type": "application/json",
  cookie: "sessionIdToken=1:token",
  origin: "http://local",
  "sec-fetch-site": "same-origin",
}

const pass: MiddlewareHandler<APIContext> = (_c, next) => next()
const noLimits: GroupFileRateLimits = { exportByUser: pass, checkByUser: pass, importByUser: pass }

/** A database that fails any use: a route that reaches it would have written something. */
const noDatabase = new Proxy(() => {}, {
  get: () => {
    throw new Error("The database was reached")
  },
  apply: () => {
    throw new Error("The database was reached")
  },
}) as unknown as postgres.Sql

function exportFile(notes: unknown[]) {
  return {
    format: GROUP_EXPORT_FORMAT,
    version: GROUP_EXPORT_VERSION,
    exportedAt: at,
    group: { name: "Family", description: "", color: null, emoji: null },
    aggregates: { tags: [], notes },
  }
}

function note(title: string) {
  return { id: uuidV7(), title, body: "", tagIds: [], createdAt: at, updatedAt: at }
}

interface Setup {
  roles?: Record<number, GroupRole>
  porter?: Partial<GroupFilePorter>
  limits?: GroupFileRateLimits
  /** `null` is a request with no session. */
  userId?: number | null
}

function app(setup: Setup = {}) {
  const real = new PostgresGroupPorter(noDatabase, [tagPortable, notePortable])
  const dependencies: GroupFileHandlerDependencies = {
    roleOf: (groupId, userId) =>
      Promise.resolve(groupId === GROUP_ID ? setup.roles?.[userId] ?? null : null),
    porter: {
      exportGroup: (...args) => real.exportGroup(...args),
      check: (...args) => real.check(...args),
      importGroup: (...args) => real.importGroup(...args),
      ...setup.porter,
    },
    newGroupAllowances: () => ({ maxNotes: null }),
  }
  const hono = new Hono<APIContext>()
  hono.use("*", async (c, next) => {
    c.set("requestId", "req-files-1")
    if (setup.userId !== null) c.set("auth", buildAuthData({ user: { id: setup.userId ?? OWNER } }))
    await next()
  })
  hono.route(
    "/groups",
    createGroupFilesRoute({
      exportGroup: createGroupExportHandler(dependencies),
      check: createGroupImportCheckHandler(dependencies),
      importGroup: createGroupImportHandler(dependencies),
      rateLimits: setup.limits ?? noLimits,
    }),
  )
  return hono
}

function post(path: string, body: string, headers: Record<string, string> = sameOrigin) {
  return new Request(`http://local/groups${path}`, { method: "POST", headers, body })
}

function exportRequest(site = "same-origin") {
  return new Request(`http://local/groups/${GROUP_ID}/export`, {
    headers: { "sec-fetch-site": site },
  })
}

/** A rate-limit store in memory, fresh for each test. */
function memoryStore(): RateLimitStore {
  const entries = new Map<string, unknown>()
  return createKvStore({
    backend: {
      get: (key) => Promise.resolve(entries.get(key)),
      set: (key, value) => Promise.resolve(void entries.set(key, value)),
      delete: (key) => Promise.resolve(void entries.delete(key)),
    },
  })
}

describe("group export route", () => {
  const streaming: Partial<GroupFilePorter> = {
    exportGroup: () =>
      Promise.resolve({
        fileName: "family-2026-10-21.json",
        chunks: (async function* () {
          yield `{"a":`
          yield `1}`
        })(),
      }),
  }

  it("streams the owner's file as an attachment", async () => {
    const response = await app({ roles: { [OWNER]: GroupRole.OWNER }, porter: streaming })
      .request(exportRequest())
    expect(response.status).toBe(200)
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="family-2026-10-21.json"`,
    )
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual({ a: 1 })
  })

  it("refuses every member but the owner, and a stranger as a missing group", async () => {
    for (
      const [role, status, code] of [
        [GroupRole.ADMIN, 403, "ROLE_INSUFFICIENT"],
        [GroupRole.EDITOR, 403, "ROLE_INSUFFICIENT"],
        [GroupRole.VIEWER, 403, "ROLE_INSUFFICIENT"],
        [undefined, 404, "GROUP_NOT_FOUND"],
      ] as const
    ) {
      const roles: Record<number, GroupRole> = role === undefined ? {} : { [OWNER]: role }
      const response = await app({ roles, porter: streaming }).request(exportRequest())
      expect(response.status).toBe(status)
      expect((await apiError(response)).reason).toBe(code)
    }
  })

  it("stops a person's exports past the hourly budget, which other sites cannot spend", async () => {
    const store = memoryStore()
    const porter: Partial<GroupFilePorter> = {
      exportGroup: () =>
        Promise.resolve({
          fileName: "family-2026-10-21.json",
          chunks: (async function* () {
            yield `{}`
          })(),
        }),
    }
    const limited = app({
      roles: { [OWNER]: GroupRole.OWNER },
      porter,
      limits: createGroupFileRateLimits({ store: () => store }),
    })
    // Another site's requests are refused before the budget, so they cannot spend it.
    for (let index = 0; index < GROUP_EXPORTS_PER_USER; index++) {
      expect((await limited.request(exportRequest("cross-site"))).status).toBe(403)
    }
    for (let index = 0; index < GROUP_EXPORTS_PER_USER; index++) {
      expect((await limited.request(exportRequest())).status).toBe(200)
    }
    expect((await limited.request(exportRequest())).status).toBe(429)
  })

  it("refuses a download another site asks for, or one with no session", async () => {
    const owner = app({ roles: { [OWNER]: GroupRole.OWNER }, porter: streaming })
    expect((await owner.request(exportRequest("cross-site"))).status).toBe(403)
    const signedOut = app({ userId: null, porter: streaming })
    expect((await signedOut.request(exportRequest())).status).toBe(401)
  })
})

describe("group import routes", () => {
  it("answers what a valid file holds and writes nothing", async () => {
    const response = await app().request(
      post("/import/check", JSON.stringify(exportFile([note("A"), note("B")]))),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      name: "Family",
      parts: [
        { kind: "notes", count: 2, one: "note", other: "notes" },
        { kind: "tags", count: 0, one: "tag", other: "tags" },
      ],
    })
  })

  it("refuses a file that is not JSON, or too large, as a bad file", async () => {
    const notJson = await app().request(post("/import/check", `{"format":`))
    expect(notJson.status).toBe(422)
    expect(await apiError(notJson)).toMatchObject({
      reason: "IMPORT_REFUSED",
      details: { problems: [{ kind: "not_export" }] },
    })
    const tooLarge = await app().request(
      post("/import/check", JSON.stringify(exportFile([])) + " ".repeat(GROUP_IMPORT_MAX_BYTES)),
    )
    expect(tooLarge.status).toBe(422)
    expect(((await apiError(tooLarge)).details as { problems: Record<string, unknown>[] }).problems)
      .toEqual([
        { kind: "too_large", maxBytes: GROUP_IMPORT_MAX_BYTES },
      ])
  })

  it("refuses a newer or invalid file on import before the database is reached", async () => {
    const newer = await app().request(
      post("/import", JSON.stringify({ file: { ...exportFile([]), version: 99 } })),
    )
    expect(newer.status).toBe(422)
    expect(((await apiError(newer)).details as { problems: Record<string, unknown>[] }).problems)
      .toEqual([{ kind: "newer_version" }])
    const invalid = await app().request(
      post("/import", JSON.stringify({ name: "Ours", file: exportFile([{ title: 5 }]) })),
    )
    expect(invalid.status).toBe(422)
    expect(
      ((await apiError(invalid)).details as { problems: Record<string, unknown>[] }).problems[0],
    ).toMatchObject({ where: "Note 1" })
  })

  it("creates the group with the name given and answers 201", async () => {
    let given: { name: string | null; file: unknown } | null = null
    const response = await app({
      porter: {
        importGroup: (input) => {
          given = input
          return Promise.resolve({ group: { id: GROUP_ID } as never, parts: [] })
        },
      },
    }).request(post("/import", JSON.stringify({ name: "Ours", file: exportFile([]) })))
    expect(response.status).toBe(201)
    expect(given!.name).toBe("Ours")
  })

  it("refuses an import from another origin", async () => {
    const response = await app().request(
      post("/import", JSON.stringify({ file: exportFile([]) }), {
        ...sameOrigin,
        origin: "http://evil.example",
        "sec-fetch-site": "cross-site",
      }),
    )
    expect(response.status).toBe(403)
  })

  it("answers a file of a million empty notes at once, without reading them", async () => {
    const empty = JSON.stringify(exportFile([]))
    const header = empty.slice(0, empty.indexOf(`"notes":[`) + `"notes":[`.length)
    const count = Math.floor((GROUP_IMPORT_MAX_BYTES - header.length - 4) / 3)
    const body = `${header}${Array(count).fill("{}").join(",")}]}}`
    expect(body.length).toBeLessThan(GROUP_IMPORT_MAX_BYTES)
    const started = performance.now()
    const response = await app().request(post("/import/check", body))
    expect(performance.now() - started).toBeLessThan(1_000)
    expect(response.status).toBe(422)
    expect(
      ((await apiError(response)).details as { problems: Record<string, unknown>[] }).problems[0],
    ).toMatchObject({ where: "Notes" })
  })

  it("stops a person's imports past the hourly budget", async () => {
    const store = memoryStore()
    const limited = app({
      limits: createGroupFileRateLimits({ store: () => store }),
      porter: {
        importGroup: () => Promise.resolve({ group: { id: GROUP_ID } as never, parts: [] }),
      },
    })
    const body = JSON.stringify({ file: exportFile([]) })
    for (let index = 0; index < GROUP_IMPORTS_PER_USER; index++) {
      expect((await limited.request(post("/import", body))).status).toBe(201)
    }
    expect((await limited.request(post("/import", body))).status).toBe(429)
  })
})
