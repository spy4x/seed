/**
 * The SPA with files off (`SPA_FILES=false`, set from the API's `FILES=false`, docs/files.md): no
 * control that uploads a file or asks for a data export, since each would only fail. The profile's
 * rows are checked in `views/ProfileView.test.tsx`; the note editor, the palette and the switch
 * itself here. Every read the page starts gets a refusal, so the page never reaches a server.
 */
import "@preact/signals"
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render } from "preact"
import { Router } from "wouter-preact"
import { memoryLocation } from "wouter-preact/memory-location"
import { act } from "preact/test-utils"
import { GroupRole } from "@domain/groups"
import { UserMFAStatus, UserRole } from "@domain/identity"
import { ENGLISH } from "@ui/i18n-testing.ts"
import { paletteCommands } from "@ui/palette-commands.ts"
import { configureModules, filesOn } from "./modules.ts"
import { loadRuntimeConfig } from "./runtime-config.ts"
import { groupsStore } from "./state/groups.ts"
import { selectionStore } from "./state/selection.ts"
import { sessionState } from "./state/session.ts"
import { offeredNoteActions } from "./views/note-actions.ts"
import { NoteEditorView } from "./views/NoteEditorView.tsx"

const window = new Window({ url: "http://app.localhost/" })
const NAMES = [
  "document",
  "location",
  "history",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "HTMLElement",
  "Element",
  "fetch",
  "CSS",
  "matchMedia",
  "addEventListener",
  "removeEventListener",
] as const
const own = Object.fromEntries(
  NAMES.map((name) => [name, (globalThis as Record<string, unknown>)[name]]),
)
const signedOut = sessionState.value

beforeAll(() => {
  // As in `views/NotesView.test.tsx`: Preact and the router read these, and every read is refused.
  const refuse = () =>
    Promise.resolve(Response.json({ error: { code: "NO", message: "No" } }, { status: 503 }))
  Object.assign(
    globalThis,
    Object.fromEntries(NAMES.map((name) => {
      if (name === "fetch") return [name, refuse]
      if (name === "matchMedia") return [name, undefined]
      const value = (window as unknown as Record<string, unknown>)[name]
      return [
        name,
        typeof value === "function" && !/^[A-Z]/.test(name) ? value.bind(window) : value,
      ]
    })),
  )
  sessionState.value = {
    ...signedOut,
    isReady: true,
    user: {
      id: 1,
      firstName: "Ada",
      lastName: "Lovelace",
      mfa: UserMFAStatus.NOT_CONFIGURED,
      role: UserRole.VIEWER,
      createdAt: new Date("2026-10-01T00:00:00Z"),
      updatedAt: new Date("2026-10-01T00:00:00Z"),
      deletedAt: null,
      lastLoginAt: new Date("2026-10-01T00:00:00Z"),
    },
  }
})

afterAll(async () => {
  Object.assign(globalThis, own)
  sessionState.value = signedOut
  await window.happyDOM.close()
})

let root: HTMLElement | null = null

afterEach(async () => {
  if (root) await act(() => render(null, root!))
  root?.remove()
  root = null
  selectionStore.groupId.value = null
  groupsStore.reset()
  configureModules({})
})

/** `/config.json` answering `body`. */
function serving(body: string): typeof fetch {
  return (() => Promise.resolve(new Response(body))) as unknown as typeof fetch
}

/** The ids of the palette's commands, with `files` as the app passes it. */
function commandIds(files?: boolean): string[] {
  return paletteCommands({
    t: ENGLISH,
    locale: `en`,
    currentGroup: null,
    online: true,
    theme: () => `system`,
    shortcuts: [],
    activityGroupId: null,
    pageCommands: [],
    guest: false,
    benchmark: false,
    canInstall: false,
    files,
  }, () => {}).map((option) => option.id)
}

/** Whether the New note page, in a group the person owns, draws its Attachments section. */
async function editorHasAttachments(): Promise<boolean> {
  groupsStore.groups.value = [{
    id: `g-1`,
    name: `Team`,
    role: GroupRole.OWNER,
    authorizationRevision: `1`,
    changeSequence: `1`,
    updatedAt: `2026-10-01T00:00:00Z`,
  }]
  groupsStore.loading.value = false
  selectionStore.groupId.value = `g-1`
  const { hook } = memoryLocation({ path: `/notes/new` })
  root = window.document.createElement(`div`) as unknown as HTMLElement
  window.document.body.appendChild(root as never)
  await act(() => render(<Router hook={hook}>{<NoteEditorView />}</Router>, root!))
  await act(() => new Promise((done) => setTimeout(done, 0)))
  const shown = root.querySelector(`[data-e2e=note-attachments]`) !== null
  await act(() => render(null, root!))
  root.remove()
  root = null
  return shown
}

describe("the files switch", () => {
  it("is off only for false, as the API reads FILES", async () => {
    const read = async (body: string) => {
      configureModules(await loadRuntimeConfig(serving(body)))
      return filesOn()
    }

    expect([await read(`{}`), await read(`{"files":"true"}`)]).toEqual([true, true])
    expect([await read(`{"files":"false"}`), await read(`{"files":" false "}`)]).toEqual([
      false,
      false,
    ])
    expect([await read(`{"files":"0"}`), await read(`{"files":"FALSE"}`)]).toEqual([true, true])
  })
})

describe("the SPA with files off", () => {
  it("draws the note editor's Attachments section only while files are on", async () => {
    const on = await editorHasAttachments()
    configureModules({ files: false })
    const off = await editorHasAttachments()

    expect({ on, off }).toEqual({ on: true, off: false })
  })

  it("offers the note page's Attach command only while files are on", () => {
    const run = {
      attach: () => {},
      copyLink: () => {},
      duplicate: () => {},
      move: () => {},
      delete: () => {},
    }
    const attach = (files?: boolean) =>
      [
        { canWrite: true, noteOpen: true, creating: false, canMove: false, files },
        { canWrite: true, noteOpen: false, creating: true, canMove: false, files },
      ].map((page) => `attach` in offeredNoteActions(page, run))

    expect(attach()).toEqual([true, true])
    expect(attach(true)).toEqual([true, true])
    expect(attach(false)).toEqual([false, false])
  })

  it("lists neither Change profile picture nor Download your data in the palette, and lists both with files on", () => {
    const fileCommands = (files?: boolean) =>
      commandIds(files).filter((id) =>
        id === `action-change-picture` || id === `action-download-data`
      )

    expect(fileCommands()).toEqual([`action-download-data`, `action-change-picture`])
    expect(fileCommands(false)).toEqual([])
  })
})
