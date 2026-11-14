/**
 * `SearchPalette` in a browser DOM (happy-dom): what a person sees before and after typing, the
 * words for an answer from the device, which actions are offered, and what picking a row asks the
 * app to do.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render } from "preact"
import { act } from "preact/test-utils"
import { FormatContext } from "@spy4x/preact-ui/format"
import { createFormatters, type Formatters } from "@spy4x/time/format"
import { GroupRole } from "@domain/groups"
import {
  emptyLabel,
  openSearch,
  type SearchChoice,
  type SearchNotesAnswer,
  SearchPalette,
  type SearchPaletteProps,
} from "./search-palette.tsx"
import { createTranslator } from "@spy4x/platform/universal/i18n"
import { I18nContext } from "@spy4x/preact-ui/i18n"
import app from "@i18n/app/en.ts"
import appRu from "@i18n/app/ru.ts"

/** The `app` catalog's English, as a screen without a provider reads it. */
const EN = createTranslator({ language: `en`, catalogs: [{ source: app }] })
/** The `app` catalog in Russian, as the SPA reads it for a person who chose Russian. */
const RU = createTranslator({ language: `ru`, catalogs: [{ source: app, translation: appRu }] })

const window = new Window({ url: "http://app.localhost/" })
const own = {
  document: globalThis.document,
  location: globalThis.location,
  getComputedStyle: globalThis.getComputedStyle,
  Element: globalThis.Element,
  HTMLElement: globalThis.HTMLElement,
}

beforeAll(() => {
  // The palette locks the page's scroll after reading its style (`getComputedStyle`).
  Object.assign(globalThis, {
    document: window.document,
    location: window.location,
    getComputedStyle: window.getComputedStyle.bind(window),
    // The hotkey listener tests its target with `instanceof Element` and `HTMLElement`.
    Element: window.Element,
    HTMLElement: window.HTMLElement,
  })
})

afterAll(async () => {
  Object.assign(globalThis, own)
  await window.happyDOM.close()
})

let root: HTMLElement | null = null

afterEach(async () => {
  if (root) await act(() => render(null, root!))
  document.body.innerHTML = ""
  root = null
})

const HOME = { id: "group-home", name: "Home", role: GroupRole.OWNER }
const STUDIO = { id: "group-studio", name: "Acme Studio", role: GroupRole.VIEWER }
const PLAN = { id: "note-plan", groupId: HOME.id, title: "Weekly plan", snippet: "…call the bank…" }
const SKETCH = { id: "note-sketch", groupId: STUDIO.id, title: "", snippet: "" }

/** The palette with two groups, Home current and writable, online, notes from `answer`. */
async function mount(
  overrides: Partial<SearchPaletteProps> = {},
  answer: (query: string) => SearchNotesAnswer | Promise<SearchNotesAnswer> = () => ({
    notes: [PLAN, SKETCH],
    onDevice: false,
  }),
  format?: Formatters,
) {
  const asked: string[] = []
  const picked: SearchChoice[] = []
  root = document.createElement("div")
  document.body.append(root)
  const palette = (
    <SearchPalette
      searchNotes={(query) => {
        asked.push(query)
        return Promise.resolve(answer(query))
      }}
      groups={[HOME, STUDIO]}
      currentGroup={{ id: HOME.id, name: HOME.name, canWrite: true }}
      online
      onSelect={(choice) => void picked.push(choice)}
      {...overrides}
    />
  )
  await act(() =>
    render(
      format ? <FormatContext.Provider value={format}>{palette}</FormatContext.Provider> : palette,
      root!,
    )
  )
  return { asked, picked }
}

/** Waits past the palette's pause in typing, letting its search and renders finish. */
async function settle(): Promise<void> {
  await act(() => new Promise((resolve) => setTimeout(resolve, 260)))
}

function find<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector(selector)
  if (!element) throw new Error(`nothing matches ${selector}`)
  return element as unknown as T
}

async function open(): Promise<void> {
  await act(() => {
    find("[data-e2e=search-open]").dispatchEvent(
      new window.MouseEvent("click", { bubbles: true }) as unknown as Event,
    )
  })
  await settle()
}

async function type(value: string): Promise<void> {
  const field = find<HTMLInputElement>("[data-e2e=search] input")
  field.value = value
  await act(() => {
    field.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event)
  })
  await settle()
}

/** The list as a person reads it: each heading, then its rows' label and detail. */
function listed(): string[] {
  return [...document.querySelectorAll("[data-e2e=search] [role=listbox] > li")].flatMap((
    item,
  ) => {
    // A heading's options sit in a `role="group"` list inside the row (preact-components 6.1).
    const group = item.querySelector("[role=group]")
    if (!group) return [text(item)]
    const heading = group.querySelector("[role=presentation]")?.textContent?.trim() ?? ""
    return [`# ${heading}`, ...[...group.querySelectorAll("[role=option]")].map(text)]
  })
}

function text(row: Element): string {
  return [...row.querySelectorAll("span, div")]
    .filter((part) => part.children.length === 0)
    .map((part) => part.textContent?.trim())
    .filter(Boolean)
    .join(" | ")
}

/** The status line under the list: the empty, loading or error words. */
function status(): string {
  return find("[data-e2e=search] [role=status]").textContent?.trim() ?? ""
}

describe("SearchPalette", () => {
  it("draws no trigger of its own, and opens on Ctrl K and on /", async () => {
    await mount()
    const dialog = find<HTMLDialogElement>("dialog[data-e2e=search]")
    expect(find("[data-e2e=search-open]").classList.contains("hidden")).toBe(true)

    for (const init of [{ key: "k", code: "KeyK", ctrlKey: true }, { key: "/", code: "Slash" }]) {
      await act(() => {
        document.body.dispatchEvent(
          new window.KeyboardEvent("keydown", { ...init, bubbles: true }) as unknown as Event,
        )
      })
      await settle()
      expect(dialog.open).toBe(true)
      await act(() => dialog.close())
    }
  })

  it("opens through openSearch on the element it is drawn in", async () => {
    await mount()
    const dialog = find<HTMLDialogElement>("dialog[data-e2e=search]")

    openSearch(document.body)
    await settle()

    expect(dialog.open).toBe(true)
    expect(document.activeElement).toBe(find("[data-e2e=search] input"))
  })

  it("lists the current group's recent notes, then Go to, Create, Settings and Account, before anything is typed", async () => {
    const { asked } = await mount()

    await open()

    expect(asked).toEqual([""])
    expect(listed()).toEqual([
      "# Notes",
      "Weekly plan | …call the bank…",
      "Untitled note",
      "# Go to",
      "Overview",
      "Notes",
      "Tags",
      "Groups",
      "Notifications",
      "Profile",
      "# Create",
      "New note | In Home",
      "New tag | In Home",
      "New group",
      "# Settings",
      "Theme | System",
      "Account | Your picture, name, email and a copy of your data.",
      "Sign-in and security | How you sign in, and where your account is signed in.",
      "Language and region | Your language, and how dates, times and numbers look.",
      "Appearance | How the app looks on this device.",
      "Notifications | Where we notify you when something changes in your groups.",
      "API tokens | Let a script or another service use one of your groups without your password.",
      "Delete account | Delete your account and everything only you can see.",
      "Download my data | A ZIP of your profile, groups and notes",
      "Change profile picture | JPEG, PNG, WebP or HEIC, up to 10 MB.",
      "Keyboard shortcuts",
      "# Account",
      "Sign out",
    ])
  })

  it("lists the open page's own commands first under This page, and hands back the picked one", async () => {
    const { picked } = await mount({
      pageCommands: [
        { id: "overview-range", label: "Change date range" },
        { id: "overview-customise", label: "Customise overview" },
      ],
    })
    await open()

    expect(listed().slice(3, 6)).toEqual(["# This page", "Change date range", "Customise overview"])

    await type("customise")
    const row = [...document.querySelectorAll("[role=option]")]
      .find((candidate) => text(candidate).startsWith("Customise overview"))!
    await act(() => {
      row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }) as unknown as Event)
    })
    expect(picked).toEqual([{ kind: "command", id: "overview-customise" }])
  })

  it("finds an action by its English label or detail in another language, and by its own words", async () => {
    root = document.createElement("div")
    document.body.append(root)
    await act(() =>
      render(
        <I18nContext.Provider value={RU}>
          <SearchPalette
            searchNotes={() => Promise.resolve({ notes: [], onDevice: false })}
            groups={[HOME]}
            currentGroup={{ id: HOME.id, name: HOME.name, canWrite: true }}
            online
            pageCommands={[{
              id: "overview-range",
              label: "Изменить период",
              aliases: ["Change date range"],
            }]}
            onSelect={() => {}}
          />
        </I18nContext.Provider>,
        root!,
      )
    )
    await open()

    await type("notifications")
    expect(listed().slice(0, 2)).toEqual(["# Переход", "Уведомления"])
    await type("уведомления")
    expect(listed().slice(0, 2)).toEqual(["# Переход", "Уведомления"])
    await type("open notifications")
    expect(listed().slice(0, 2)).toEqual(["# Переход", "Уведомления"])
    await type("date range")
    expect(listed()).toContain("Изменить период")
    // The English detail finds its command too.
    await type("where your account")
    expect(listed().some((row) => row.startsWith("Вход и безопасность"))).toBe(true)
  })

  it("offers Go to Overview only while there is a current group", async () => {
    await mount({ currentGroup: null })
    await open()

    expect(listed()).not.toContain("Overview")
  })

  it("lists matching notes with their group above the groups and commands, with the role and the current group", async () => {
    await mount()
    await open()

    await type("  ho ")

    expect(listed().slice(0, 5)).toEqual([
      "# Notes",
      "Weekly plan | Home · …call the bank…",
      "Untitled note | Acme Studio",
      "# Groups",
      "Home | Owner | Current",
    ])
    expect(listed()).toContain("New note | In Home")
  })

  it("highlights the strongest match first across groups and commands", async () => {
    const TEAM = { id: "group-team", name: "Acme design team", role: GroupRole.EDITOR }
    const PARK = { id: "group-park", name: "Park rangers", role: GroupRole.EDITOR }
    await mount({ groups: [HOME, TEAM, PARK] }, () => ({ notes: [], onDevice: false }))
    await open()
    const highlighted = () => text(find("[data-e2e=search] [role=option][aria-selected=true]"))

    for (const query of ["тема", "ntvf"]) {
      await type(query)
      expect(highlighted()).toMatch(/^Theme \|/)
      expect(listed()).toContain("Acme design team | Editor")
    }

    await type("dark")
    expect(highlighted()).toMatch(/^Theme \|/)
    expect(listed()).toContain("Park rangers | Editor")

    await type("design team")
    expect(highlighted()).toBe("Acme design team | Editor")
  })

  it("names no group in a found note's row when the person has one group", async () => {
    await mount({ groups: [HOME] })
    await open()

    await type("plan")

    expect(listed()[1]).toBe("Weekly plan | …call the bank…")
  })

  it("heads the notes from the device as such, and says so when nothing matches", async () => {
    await mount(
      {},
      (query) => query === "zz" ? { notes: [], onDevice: true } : { notes: [PLAN], onDevice: true },
    )
    await open()

    await type("plan")
    expect(listed()[0]).toBe("# Notes on this device")

    await type("zz")
    expect(listed()).toEqual([])
    expect(status()).toBe(
      "Nothing on this device matches “zz”. Search again when you're back online.",
    )
  })

  it("repeats a long query cut to forty characters when nothing matches", async () => {
    await mount({}, () => ({ notes: [], onDevice: false }))
    await open()

    await type(`${"x".repeat(45)}`)

    expect(status()).toBe(`Nothing matches “${"x".repeat(40)}…”.`)
    expect(emptyLabel(EN, "  ab  ", false)).toBe("Nothing matches “ab”.")
  })

  it("with the notes off, never asks for notes and lists no notes, tags or note commands", async () => {
    const { asked } = await mount({ notes: false })

    await open()
    const before = listed()
    await type("notes")
    const notesQuery = listed()
    await type("tag")

    expect(asked).toEqual([])
    expect(before.slice(0, 5)).toEqual([
      "# Go to",
      "Overview",
      "Groups",
      "Notifications",
      "Profile",
    ])
    for (const row of [...before, ...notesQuery, ...listed()]) {
      expect(row).not.toMatch(/^(# Notes|Notes|Tags|New note|New tag)\b/)
    }
  })

  it("with the notes off, says nothing matches a one-character query instead of asking for notes", async () => {
    await mount({ notes: false })
    await open()

    await type("7")

    expect(status()).toBe("Nothing matches “7”.")
  })

  it("does not search notes for a single character, but still matches groups", async () => {
    const { asked } = await mount()
    await open()

    await type("a")

    expect(asked).toEqual([""])
    expect(listed()).toContain("Acme Studio | Viewer")
  })

  it("asks for a second character, instead of saying no note matches, when one character finds nothing", async () => {
    await mount()
    await open()

    // A letter can start a word in the other layout or alphabet ("q" is "й"), a digit cannot.
    await type("7")

    expect(listed()).toEqual([])
    expect(status()).toBe("Type at least 2 characters to search notes.")
  })

  it("offers no new note or tag in a group the person may only read, and dims New group offline", async () => {
    await mount({
      currentGroup: { id: STUDIO.id, name: STUDIO.name, canWrite: false },
      online: false,
    })

    await open()

    const rows = listed()
    for (const action of ["New note", "New tag"]) {
      expect(rows.some((row) => row.startsWith(action))).toBe(false)
    }
    const newGroup = [...document.querySelectorAll("[role=option]")]
      .find((candidate) => text(candidate).startsWith("New group"))!
    expect([newGroup.getAttribute("aria-disabled"), text(newGroup)])
      .toEqual(["true", "New group | Needs a connection"])
  })

  it("offers a guest Keep your account for the words a person would try, and nobody else", async () => {
    await mount({ guest: true })
    await open()
    await type("register")
    expect(listed().some((row) => row.startsWith("Keep your account"))).toBe(true)

    await act(() => render(null, root!))
    await mount()
    await open()
    await type("register")
    expect(listed().some((row) => row.startsWith("Keep your account"))).toBe(false)
  })

  it("finds Change profile picture by avatar, photo and фото, and opens the row's chooser", async () => {
    const { picked } = await mount()
    for (const query of ["avatar", "photo", "фото"]) {
      await open()
      await type(query)
      const row = [...document.querySelectorAll("[role=option]")]
        .find((candidate) => text(candidate).startsWith("Change profile picture"))
      expect(row, query).toBeDefined()
      await act(() => {
        row!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }) as unknown as Event)
      })
    }
    expect(picked).toEqual(
      Array(3).fill({ kind: "page", href: "/profile/account#profile-picture-choose" }),
    )
  })

  it("writes the picture rule's size in the person's region format", async () => {
    await mount({}, undefined, createFormatters({ locale: `ru-RU`, timeZone: `UTC` }))
    await open()
    await type("avatar")
    const row = [...document.querySelectorAll("[role=option]")]
      .find((candidate) => text(candidate).startsWith("Change profile picture"))
    expect(text(row!)).toContain("10 МБ")
  })

  it("finds Download my data by the words a person would try, and opens the Account section's row", async () => {
    const { picked } = await mount()
    for (const query of ["GDPR", "export", "скачать данные", "archive"]) {
      await open()
      await type(query)
      const row = [...document.querySelectorAll("[role=option]")]
        .find((candidate) => text(candidate).startsWith("Download my data"))
      expect(row, query).toBeDefined()
      await act(() => {
        row!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }) as unknown as Event)
      })
    }
    expect(picked).toEqual(
      Array(4).fill({ kind: "page", href: "/profile/account#your-data" }),
    )
  })

  it("finds Open benchmark by speed test, speedtest and тест скорости, only when it is offered", async () => {
    const queries = ["speed test", "speedtest", "тест скорости"]
    const { picked } = await mount({ benchmark: true })
    for (const query of queries) {
      await open()
      await type(query)
      const row = [...document.querySelectorAll("[role=option]")]
        .find((candidate) => text(candidate).startsWith("Open benchmark"))
      expect(row, query).toBeDefined()
      await act(() => {
        row!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }) as unknown as Event)
      })
    }
    expect(picked).toEqual(Array(3).fill({ kind: "page", href: "/benchmark" }))

    await act(() => render(null, root!))
    await mount()
    await open()
    await type("speed test")
    expect(listed().some((row) => row.startsWith("Open benchmark"))).toBe(false)
  })

  it("shows the error line when the search fails", async () => {
    await mount(
      {},
      (query) => query === "" ? { notes: [], onDevice: false } : Promise.reject(new Error("429")),
    )
    await open()

    await type("plan")

    expect(status()).toBe("Could not search. Change your search to try again.")
  })

  it("draws the app's shortcut keys, a g sequence among them, without failing", async () => {
    await mount({
      shortcuts: [
        { keys: "n", description: "Shortcuts.newNoteRow", group: "General" },
        { keys: "g n", description: "Frame.notes", group: "Go to" },
      ],
    })
    await open()
    const keys = (label: string) =>
      [...document.querySelectorAll("[role=option]")]
        .find((candidate) => text(candidate).startsWith(label))
        ?.getAttribute("aria-keyshortcuts")

    expect([keys("New note"), keys("Notes")]).toEqual(["N", null])
  })

  it("switches to a group on Enter and opens its settings on Ctrl Enter", async () => {
    const { picked } = await mount({}, () => ({ notes: [], onDevice: false }))
    for (const ctrlKey of [false, true]) {
      await open()
      await type("switch to acme")
      await act(() => {
        find("[data-e2e=search] input").dispatchEvent(
          new window.KeyboardEvent("keydown", {
            key: "Enter",
            ctrlKey,
            bubbles: true,
          }) as unknown as Event,
        )
      })
    }
    expect(picked).toEqual([
      { kind: "switch-group", groupId: STUDIO.id },
      { kind: "group-settings", groupId: STUDIO.id },
    ])
  })

  it("applies Dark from the Theme submenu at once and keeps the palette open", async () => {
    const { picked } = await mount()
    const dialog = find<HTMLDialogElement>("dialog[data-e2e=search]")
    const pick = async (label: string) => {
      const row = [...document.querySelectorAll("[role=option]")]
        .find((candidate) => text(candidate).startsWith(label))!
      await act(() => {
        row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }) as unknown as Event)
      })
      await settle()
    }
    await open()
    await type("dark")

    await pick("Theme")
    await pick("Dark")

    expect(picked).toEqual([{ kind: "theme", theme: "dark" }])
    expect(dialog.open).toBe(true)
  })

  it("asks the app to open a picked note of another group in that group, and switch to a picked group", async () => {
    const { picked } = await mount()
    const pick = async (label: string) => {
      const row = [...document.querySelectorAll("[role=option]")]
        .find((candidate) => text(candidate).startsWith(label))!
      await act(() => {
        row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }) as unknown as Event)
      })
    }
    await open()
    await type("sketch")
    await pick("Untitled note")

    await open()
    await type("acme")
    await pick("Acme Studio |")

    expect(picked).toEqual([
      { kind: "note", noteId: SKETCH.id, groupId: STUDIO.id },
      { kind: "switch-group", groupId: STUDIO.id },
    ])
  })

  it("picks the first result with Enter", async () => {
    const { picked } = await mount()
    await open()

    await act(() => {
      find("[data-e2e=search] input").dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }) as unknown as Event,
      )
    })

    expect(picked).toEqual([{ kind: "note", noteId: PLAN.id, groupId: HOME.id }])
  })
})
