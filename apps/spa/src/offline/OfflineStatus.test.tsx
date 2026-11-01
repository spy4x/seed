/**
 * What the sync strip shows a person: a tag write the server refused, with both sides and a way to
 * choose, and the notice that a tag was taken off their notes. Drawn in a browser DOM (happy-dom)
 * over a layer that holds the queue in memory.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { type ComponentChildren, render } from "preact"
import { useEffect } from "preact/hooks"
import { act } from "preact/test-utils"
import type { CallPort } from "@spy4x/realtime/calls"
import { createTranslator, type Translator } from "@spy4x/platform/universal/i18n"
import { I18nContext } from "@spy4x/preact-ui/i18n"
import app from "@i18n/app/en.ts"
import appRu from "@i18n/app/ru.ts"
import { conflictsToReview, OfflineStatus } from "./OfflineStatus.tsx"
import { startOffline, stopOffline } from "./index.ts"
import { createMemoryStorage } from "./memory-storage.ts"

const window = new Window({ url: "http://app.localhost/" })
const own = { document: globalThis.document }

beforeAll(() => {
  Object.assign(globalThis, { document: window.document })
})

afterAll(async () => {
  Object.assign(globalThis, own)
  await window.happyDOM.close()
})

let root: HTMLElement | null = null

afterEach(async () => {
  if (root) await act(() => render(null, root!))
  root = null
  conflictsToReview.value = null
  await stopOffline()
})

/** Lets the layer read its queues. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn++) await new Promise((resolve) => setTimeout(resolve, 0))
}

/** The `app` catalog in Russian, as the SPA reads it for a person who chose Russian. */
const RU = createTranslator({ language: `ru`, catalogs: [{ source: app, translation: appRu }] })

/**
 * A layer that may not send, on a device that holds `storage`, drawn as the strip, in English or
 * in `translator`'s language.
 */
async function mountStrip(
  storage: ReturnType<typeof createMemoryStorage>,
  translator?: Translator<string>,
  Frame: (props: { children: ComponentChildren }) => ComponentChildren = ({ children }) => children,
) {
  const layer = startOffline(
    7,
    { calls: {} as unknown as CallPort, canSend: () => false },
    storage,
  )
  await settle()
  root = window.document.createElement("div") as unknown as HTMLElement
  window.document.body.append(root as never)
  const strip = (
    <Frame>
      <OfflineStatus groupId="g-1" onResolved={() => {}} />
    </Frame>
  )
  await act(() =>
    render(
      translator ? <I18nContext.Provider value={translator}>{strip}</I18nContext.Provider> : strip,
      root!,
    )
  )
  return layer
}

const text = () => root!.textContent ?? ""

/**
 * A frame that, like the app's route announcer, moves focus to its page heading in an effect that
 * runs after the strip's own.
 */
function PageThatTakesFocus({ children }: { children: ComponentChildren }) {
  useEffect(() => {
    ;(window.document.getElementById("page-heading") as unknown as HTMLElement | null)?.focus()
  }, [])
  return (
    <main>
      <h1 id="page-heading" tabIndex={-1}>Notes</h1>
      {children}
    </main>
  )
}

/** The server's side of a tag the person changed offline. */
const SERVER_TAG = {
  id: "t-1",
  groupId: "g-1",
  name: "Theirs",
  color: "#1d4ed8",
  version: 2,
  changeSequence: "2",
  createdByUserId: 7,
  updatedByUserId: 8,
  createdAt: "2026-10-02T00:00:00.000Z",
  updatedAt: "2026-10-02T00:00:00.000Z",
}

/** A queued rename of the tag Mine that the server did not take. */
const TAG_CONFLICT = {
  key: "tag-key",
  entityId: "t-1",
  kind: "update" as const,
  baseVersion: 1,
  payload: { groupId: "g-1", name: "Mine", color: "#b91c1c" },
  attempted: true,
  status: "conflict" as const,
  queuedAt: "2026-10-01T08:00:00.000Z",
}

describe("OfflineStatus", () => {
  it("shows a tag the server refused with both sides, so the person can choose", async () => {
    const storage = createMemoryStorage()
    await storage.of(7).tagsQueue.putEntry({
      key: "tag-key",
      entityId: "t-1",
      kind: "update",
      baseVersion: 1,
      payload: { groupId: "g-1", name: "Mine", color: "#b91c1c" },
      attempted: true,
      status: "conflict",
      queuedAt: "2026-10-01T08:00:00.000Z",
      conflict: {
        reason: "version",
        message: "Someone changed this tag.",
        server: {
          id: "t-1",
          groupId: "g-1",
          name: "Theirs",
          color: "#1d4ed8",
          version: 2,
          changeSequence: "2",
          createdByUserId: 7,
          updatedByUserId: 8,
          createdAt: "2026-10-02T00:00:00.000Z",
          updatedAt: "2026-10-02T00:00:00.000Z",
        },
      },
    })

    await mountStrip(storage)

    expect(root!.querySelector("[data-e2e=tag-sync-conflict]")).not.toBeNull()
    expect(root!.querySelector("[data-e2e=conflict-mine]")?.textContent).toBe("Mine (Red)")
    expect(root!.querySelector("[data-e2e=conflict-theirs]")?.textContent).toBe("Theirs (Blue)")
    expect(text()).toContain("Tag \u2068Mine\u2069")
  })

  it("puts focus on the conflict chooser's heading when Review changes sent the person here", async () => {
    const storage = createMemoryStorage()
    await storage.of(7).tagsQueue.putEntry(TAG_CONFLICT)
    conflictsToReview.value = "g-1"

    await mountStrip(storage, undefined, PageThatTakesFocus)
    await settle()

    const focused = window.document.activeElement
    expect(focused?.tagName).toBe("H2")
    expect(focused?.textContent).toBe(root!.querySelector("[aria-labelledby] h2")?.textContent)
    expect(root!.contains(focused as never)).toBe(true)
    // Asked once: a later chooser takes no focus on its own.
    expect(conflictsToReview.value).toBeNull()
  })

  it("leaves focus where it was when Review changes named another group", async () => {
    const storage = createMemoryStorage()
    await storage.of(7).tagsQueue.putEntry(TAG_CONFLICT)
    conflictsToReview.value = "g-2"
    const before = window.document.createElement("button")
    before.id = "outside"
    window.document.body.append(before)
    before.focus()

    try {
      await mountStrip(storage)
      await settle()

      // By id: a failing diff of two happy-dom elements never finishes printing.
      expect(window.document.activeElement?.id).toBe("outside")
      expect(conflictsToReview.value).toBe("g-2")
    } finally {
      before.remove()
    }
  })

  it("keeps a section gap between itself and the page header under it", async () => {
    const storage = createMemoryStorage()
    await storage.of(7).tagsQueue.putEntry({
      key: "tag-key",
      entityId: "t-1",
      kind: "create",
      baseVersion: 0,
      payload: { groupId: "g-1", name: "Mine", color: "#b91c1c" },
      attempted: false,
      status: "pending",
      queuedAt: "2026-10-01T08:00:00.000Z",
    })

    await mountStrip(storage)

    expect(root!.querySelector("[data-e2e=offline-status]")!.classList.contains("mb-8")).toBe(true)
  })

  it("tells the person a tag was taken off their notes, until they dismiss it", async () => {
    const layer = await mountStrip(createMemoryStorage())
    await act(() => {
      layer.notices.value = [{ key: `OfflineStatus.tagTakenOff`, values: { count: 2 } }]
    })
    expect(root!.querySelector("[data-e2e=sync-notice]")?.textContent).toContain(
      "A tag you created offline couldn't be saved, so we removed it from 2 notes.",
    )

    await act(() => {
      ;(root!.querySelector("[data-e2e=sync-notice-dismiss]") as HTMLElement).click()
    })
    expect(root!.querySelector("[data-e2e=sync-notice]")).toBeNull()
  })
  it("shows a conflict and its stored message in the person's language", async () => {
    const storage = createMemoryStorage()
    await storage.of(7).tagsQueue.putEntry({
      ...TAG_CONFLICT,
      conflict: { reason: "version", message: `TagSync.version`, server: SERVER_TAG },
    })

    await mountStrip(storage, RU)

    expect(root!.querySelector("[data-e2e=conflict-message]")?.textContent).toBe(
      "Пока вы были не в сети, кто-то изменил эту метку.",
    )
    expect(text()).toContain("Ваша версия")
    expect(text()).toContain("Версия на сервере")
    expect(text()).toContain("Метка \u2068Mine\u2069")
    expect(text()).not.toContain("Your version")
  })

  it("shows the server's own words for a refused tag as they came", async () => {
    const storage = createMemoryStorage()
    await storage.of(7).tagsQueue.putEntry({
      ...TAG_CONFLICT,
      conflict: { reason: "rejected", message: "Your role no longer allows tags.", server: null },
    })

    await mountStrip(storage, RU)

    expect(root!.querySelector("[data-e2e=conflict-message]")?.textContent).toBe(
      "Your role no longer allows tags.",
    )
  })

  it("says in the person's language that a tag was taken off notes, and dismisses it", async () => {
    const layer = await mountStrip(createMemoryStorage(), RU)

    await act(() => {
      layer.notices.value = [{ key: `OfflineStatus.tagTakenOff`, values: { count: 2 } }]
    })
    expect(root!.querySelector("[data-e2e=sync-notice]")?.textContent).toContain(
      "сняли её с 2 заметок",
    )
    expect(root!.querySelector("[data-e2e=sync-notice-dismiss]")?.textContent).toBe("Скрыть")
  })
})
