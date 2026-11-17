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
  openSearch,
  type PaletteRecord,
  type SearchChoice,
  type SearchNotesAnswer,
  SearchPalette,
  type SearchPaletteProps,
  storedRecent,
} from "./search-palette.tsx"
import { createTranslator } from "@spy4x/platform/universal/i18n"
import { I18nContext } from "@spy4x/preact-ui/i18n"
import app from "@i18n/app/en.ts"
import appRu from "@i18n/app/ru.ts"

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

/**
 * Types `value` without waiting a fixed time; pair it with {@link until} for what the answer
 * shows.
 */
async function fill(value: string): Promise<void> {
  const field = find<HTMLInputElement>("[data-e2e=search] input")
  field.value = value
  await act(() => {
    field.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event)
  })
}

/** Waits until `check` holds, failing after two seconds with what the list showed. */
async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out; the list shows ${listed().join(" / ")}`)
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)))
  }
}

/** `text` as a quick-create row shows it: isolated, so its direction cannot reorder the label. */
function isolated(text: string): string {
  return `\u2068${text}\u2069`
}

/** Whether the answer for typed text is listed: it has a quick-create row such as `New group: “…”`. */
function quickCreateListed(): boolean {
  return listed().some((row) => row.includes(": “"))
}

/** Presses Enter, or Ctrl Enter with `ctrlKey`, in the palette's field. */
async function enter(ctrlKey = false): Promise<void> {
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

/**
 * How many of the two commands that need the file store ("Download my data", "Change profile
 * picture") the palette lists for "data" and "picture", with `files` as the app passes it.
 */
async function fileCommandsFound(files?: boolean): Promise<number> {
  await mount({ files })
  await open()
  await type("data")
  const data = listed()
  await type("picture")
  return [...data, ...listed()].filter((row) =>
    /^(Download my data|Change profile picture)\b/.test(row)
  ).length
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

  it("lists three of This page's commands, the current group's recent notes and three of Create's, before anything is typed", async () => {
    const { asked } = await mount({
      pageCommands: ["Copy link", "Move", "Duplicate", "Delete this note"].map((label) => ({
        id: label,
        label,
      })),
    })

    await open()

    expect(asked).toEqual([""])
    expect(listed()).toEqual([
      "# This page",
      "Copy link",
      "Move",
      "Duplicate",
      "# Notes",
      "Weekly plan | …call the bank…",
      "Untitled note",
      "# Create",
      "New note | In Home",
      "New tag | In Home",
      "Import notes | In Home",
    ])
    // The empty field invites ">", which lists the commands alone.
    expect(find("[data-e2e=search]").textContent).toContain("> for commands")
  })

  it("lists every command under its section for > alone, and only the commands that match for > and text", async () => {
    const { asked } = await mount()
    await open()

    await type(">")
    const headings = listed().filter((row) => row.startsWith("# "))
    expect(headings).toEqual(["# Go to", "# Create", "# Settings", "# Account"])
    expect(listed()).toContain("Sign out")

    // No note, group or record: only the empty query's notes were ever asked for.
    await type("> home")
    expect(asked).toEqual([""])
    expect(listed().some((row) => row.startsWith("Home |"))).toBe(false)
    await type(">sign out")
    expect(listed()[0]).toBe("# Commands")
    expect(listed()[1]).toBe("Sign out | Account")
  })

  it("lists the open page's own commands first under This page, and hands back the picked one", async () => {
    const { picked } = await mount({
      pageCommands: [
        { id: "overview-range", label: "Change date range" },
        { id: "overview-customise", label: "Customise overview" },
      ],
    })
    await open()

    expect(listed().slice(0, 3)).toEqual(["# This page", "Change date range", "Customise overview"])

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
              englishWords: ["Change date range"],
            }]}
            onSelect={() => {}}
          />
        </I18nContext.Provider>,
        root!,
      )
    )
    await open()

    // Under one heading, each naming its section. Only the label in the person's language starts a
    // Best match ("Best match" is preact-ui's own word, whose catalog this test leaves out).
    await type("notifications")
    expect(listed().slice(0, 2)).toEqual(["# Команды", "Уведомления | Переход"])
    await type("уведомления")
    expect(listed().slice(0, 2)).toEqual(["# Best match", "Уведомления | Переход"])
    await type("open notifications")
    expect(listed().slice(0, 2)).toEqual(["# Команды", "Уведомления | Переход"])
    await type("date range")
    expect(listed()).toContain("Изменить период | На этой странице")
    // The English detail finds its command too.
    await type("where your account")
    expect(listed().some((row) => row.startsWith("Вход и безопасность"))).toBe(true)
  })

  it("offers Go to Overview only while there is a current group", async () => {
    await mount({ currentGroup: null })
    await open()

    expect(listed()).not.toContain("Overview")
  })

  it("lists matching notes with their group, then the groups with the role and the current group, then the commands, records and Create", async () => {
    await mount({
      records: [{
        heading: "Accounts",
        records: () => [{ id: "a1", label: "Studio rent", href: "/accounts/a1" }],
      }],
    })
    await open()

    await type("  studio ")

    expect(listed().filter((row) => row.startsWith("# "))).toEqual([
      "# Notes",
      "# Groups",
      "# Accounts",
      "# Create",
    ])
    expect(listed().slice(0, 5)).toEqual([
      "# Notes",
      "Weekly plan | Home · …call the bank…",
      "Untitled note | Acme Studio",
      "# Groups",
      "Acme Studio | Viewer",
    ])
    await type("home")
    expect(listed()).toContain("Home | Owner | Current")
    await type("theme")
    expect(listed().filter((row) => row.startsWith("# ")).slice(-2)).toEqual([
      "# Commands",
      "# Create",
    ])
  })

  it("lists at most six commands, the Best match among them, each naming its section", async () => {
    await mount({}, () => ({ notes: [], onDevice: false }))
    await open()

    // "settings" is an alias of the Theme command and of every one of the seven profile sections.
    await type("settings")
    const rows = listed()
    // The Best match is the first of the six, taken out from under Commands.
    const commands = rows.slice(1, rows.indexOf("# Create"))
      .filter((row) => !row.startsWith("# "))
    expect(rows[0]).toBe("# Best match")
    expect(commands.length).toBe(6)
    for (const row of commands) expect(row).toMatch(/\| Settings( · | \||$)/)
  })

  it("pins the page's Delete command as Best match above a note whose text matches, and picks it on Enter", async () => {
    const WELCOME = {
      id: "note-welcome",
      groupId: HOME.id,
      title: "Welcome",
      snippet: "…delete it…",
    }
    const { picked } = await mount(
      { pageCommands: [{ id: "note-delete", label: "Delete this note" }] },
      () => ({ notes: [WELCOME], onDevice: false }),
    )
    await open()

    await type("delete this")
    expect(listed().slice(0, 4)).toEqual([
      "# Best match",
      "Delete this note | This page",
      "# Notes",
      "Welcome | Home · …delete it…",
    ])
    await enter()

    expect(picked).toEqual([{ kind: "command", id: "note-delete" }])
  })

  it("pins no Best match for a query that starts no command's name", async () => {
    await mount({}, () => ({ notes: [PLAN], onDevice: false }))
    await open()

    await type("weekly")

    expect(listed()[0]).toBe("# Notes")
    expect(listed()).not.toContain("# Best match")
  })

  it("pins a group as Best match for the start of its name, and switches to it on Enter", async () => {
    const { picked } = await mount({}, () => ({ notes: [], onDevice: false }))
    await open()

    await type("acme")
    await until(quickCreateListed)

    expect(listed()[0]).toBe("# Best match")
    expect(listed()[1]).toContain("Acme Studio")
    await enter()
    expect(picked).toEqual([{ kind: "switch-group", groupId: STUDIO.id }])
  })

  it("pins Theme → Dark as Best match for dark, and Enter turns the theme dark with the palette open", async () => {
    const { picked } = await mount({}, () => ({ notes: [], onDevice: false }))
    const dialog = find<HTMLDialogElement>("dialog[data-e2e=search]")
    await open()

    for (const query of ["dark", "dark mode", "тёмная"]) {
      await type(query)
      expect(listed().slice(0, 2)).toEqual(["# Best match", "Theme → Dark | Settings"])
    }
    await enter()

    expect(picked).toEqual([{ kind: "theme", theme: "dark" }])
    expect(dialog.open).toBe(true)
  })

  it("lists no theme row before anything is typed", async () => {
    await mount()
    await open()

    expect(listed().some((row) => row.startsWith("Theme →"))).toBe(false)
  })

  it("names no group in a found note's row when the person has one group", async () => {
    await mount({ groups: [HOME] })
    await open()

    await type("plan")

    expect(listed()[1]).toBe("Weekly plan | …call the bank…")
  })

  it("heads the notes from the device as such", async () => {
    await mount({}, () => ({ notes: [PLAN], onDevice: true }))
    await open()

    await type("plan")

    expect(listed()[0]).toBe("# Notes on this device")
  })

  it("offers New note, New tag and New group from any text nothing else matches, under Create", async () => {
    await mount({}, () => ({ notes: [], onDevice: false }))
    await open()

    await fill("groceries")
    await until(quickCreateListed)

    expect(listed()).toEqual([
      "# Create",
      `New note: “${isolated("groceries")}” | In Home`,
      `New tag: “${isolated("groceries")}” | In Home`,
      `New group: “${isolated("groceries")}”`,
    ])
  })

  it("says offline that only this device was searched when no note matched, in a dimmed row that never takes the highlight", async () => {
    const { picked } = await mount({}, () => ({ notes: [], onDevice: true }))
    const hint = () => document.querySelector("[data-e2e=search] [role=option][aria-disabled=true]")
    const sentence =
      "Nothing on this device matches “snorkel”. Search again when you're back online."
    await open()

    await fill("snorkel")
    await until(() => listed().includes(sentence))

    expect(listed().slice(-2)).toEqual(["# Notes on this device", sentence])
    expect(hint()?.textContent).toBe(sentence)
    expect(hint()?.getAttribute("aria-selected")).toBe("false")
    expect(text(find("[data-e2e=search] [role=option][aria-selected=true]"))).toBe(
      `New note: “${isolated("snorkel")}” | In Home`,
    )
    await act(() => {
      hint()!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }) as unknown as Event)
    })
    expect(picked).toEqual([])
    expect(find("[data-e2e=search] input")).toBeTruthy()
  })

  it("says nothing about the device online when no note matched", async () => {
    await mount({}, () => ({ notes: [], onDevice: false }))
    await open()

    await fill("snorkel")
    await until(quickCreateListed)

    expect(listed().some((row) => row.startsWith("Nothing"))).toBe(false)
    expect(document.querySelector("[data-e2e=search] [role=option][aria-disabled=true]")).toBeNull()
  })

  it("says a query too short to search notes needs another character, in a dimmed row", async () => {
    const { asked } = await mount({}, () => ({ notes: [], onDevice: true }))
    await open()

    await fill("s")
    await until(() => listed().includes("Type at least 2 characters to search notes."))

    expect(listed().slice(-2)).toEqual(["# Notes", "Type at least 2 characters to search notes."])
    expect(find("[data-e2e=search] [role=option][aria-disabled=true]").textContent).toBe(
      "Type at least 2 characters to search notes.",
    )
    expect(asked).not.toContain("s")
    expect(listed().some((row) => row.startsWith("Nothing"))).toBe(false)
  })

  it("shows a long query cut to forty characters in its rows, an emoji counting as one, and hands back all of it", async () => {
    const { picked } = await mount({}, () => ({ notes: [], onDevice: false }))
    const long = `${"🛒".repeat(41)} שלום`
    await open()

    await fill(long)
    await until(quickCreateListed)
    await enter()

    expect(listed()[1]).toBe(`New note: “${isolated(`${"🛒".repeat(40)}…`)}” | In Home`)
    expect(picked).toEqual([{ kind: "quick-create", entity: "note", title: long }])
  })

  it("shows markup-like text as typed, never as markup", async () => {
    await mount({}, () => ({ notes: [], onDevice: false }))
    await open()

    await fill(`<img src=x onerror=alert(1)>`)
    await until(quickCreateListed)

    expect(listed()[1]).toBe(`New note: “${isolated(`<img src=x onerror=alert(1)>`)}” | In Home`)
    expect(document.querySelector("[data-e2e=search] img")).toBeNull()
  })

  it("offers no quick-create row for a query of spaces only", async () => {
    await mount()
    await open()

    await fill("   ")
    // The empty query's answer: the recent notes first.
    await until(() =>
      listed()[0] === "# Notes" && listed().includes("Weekly plan | …call the bank…")
    )

    expect(listed().some((row) => row.includes("“"))).toBe(false)
  })

  it("opens the create form on Enter on a quick-create row, and creates at once on Ctrl Enter", async () => {
    const { picked } = await mount({}, () => ({ notes: [], onDevice: false }))
    for (const ctrlKey of [false, true]) {
      await open()
      await fill("  groceries ")
      await until(quickCreateListed)
      await enter(ctrlKey)
    }
    expect(picked).toEqual([
      { kind: "quick-create", entity: "note", title: "groceries" },
      { kind: "quick-create", entity: "note", title: "groceries", now: true },
    ])
  })

  it("with the notes off, never asks for notes and lists no notes, tags or note commands", async () => {
    const { asked } = await mount({ notes: false })

    await open()
    const before = listed()
    await type("notes")
    const notesQuery = listed()
    await type("tag")

    expect(asked).toEqual([])
    expect(before).toEqual(["# Create", "New group"])
    for (const row of [...before, ...notesQuery, ...listed()]) {
      expect(row).not.toMatch(/^(# Notes|Notes|Tags|New note|New tag)\b/)
    }
  })

  it("with the notes off, says Download my data makes a ZIP of the profile and groups", async () => {
    await mount({ notes: false })
    await open()

    await type("download")

    expect(listed()).toContain("Download my data | Settings · A ZIP of your profile and groups")
  })

  it("lists Download my data and Change profile picture while files are on", async () => {
    expect(await fileCommandsFound()).toBe(2)
  })

  it("with files off, lists neither Download my data nor Change profile picture", async () => {
    expect(await fileCommandsFound(false)).toBe(0)
  })

  it("with the notes off, offers only New group from a query nothing else matches", async () => {
    await mount({ notes: false })
    await open()

    await fill("7")
    await until(quickCreateListed)

    expect(listed()).toEqual(["# Create", `New group: “${isolated("7")}”`])
  })

  it("does not search notes for a single character, but still matches groups", async () => {
    const { asked } = await mount()
    await open()

    await type("a")

    expect(asked).toEqual([""])
    expect(listed()).toContain("Acme Studio | Viewer")
  })

  it("offers the quick-create rows for one character, which searches no notes", async () => {
    const { asked } = await mount()
    await open()

    // A letter can start a word in the other layout or alphabet ("q" is "й"), a digit cannot.
    await fill("7")
    await until(quickCreateListed)

    expect(asked).toEqual([""])
    expect(listed()[0]).toBe("# Create")
  })

  it("offers no new note or tag, typed or not, in a group the person may only read, and dims New group offline", async () => {
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

    await fill("groceries")
    await until(() => listed().some((row) => row.startsWith("New group:")))
    const quick = listed().filter((row) => row.includes("groceries"))
    expect(quick).toEqual([`New group: “${isolated("groceries")}” | Needs a connection`])
    const quickGroup = [...document.querySelectorAll("[role=option]")]
      .find((candidate) => text(candidate).startsWith("New group:"))!
    expect(quickGroup.getAttribute("aria-disabled")).toBe("true")
  })

  it("lists Download my data offline, dimmed, and does nothing on Enter while it is highlighted", async () => {
    const { picked } = await mount({ online: false }, () => ({ notes: [], onDevice: true }))
    await open()

    await type("download my data")
    const row = find("[data-e2e=search] [role=option][aria-selected=true]")
    expect([text(row), row.getAttribute("aria-disabled")])
      .toEqual(["Download my data | Needs a connection", "true"])
    await enter()

    expect(picked).toEqual([])
    expect(find("[data-e2e=search] input")).toBeTruthy()
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

  it("hands back only a page for each risky account command: the button that opens its confirmation", async () => {
    const { picked } = await mount({ twoFactor: true })
    const rows = [
      ["delete account", "Delete my account"],
      ["удалить аккаунт", "Delete my account"],
      ["disable 2fa", "Turn off two-factor sign-in"],
      ["отключить двухфакторную", "Turn off two-factor sign-in"],
      ["end other sessions", "Sign out of all other devices"],
      ["выйти на других устройствах", "Sign out of all other devices"],
    ]
    for (const [query, label] of rows) {
      await open()
      await type(query)
      const row = [...document.querySelectorAll("[role=option]")]
        .find((candidate) => text(candidate) === `${label} | Account`)
      expect(row, query).toBeDefined()
      await act(() => {
        row!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }) as unknown as Event)
      })
    }
    expect(picked).toEqual([
      { kind: "page", href: "/profile/danger-zone#account-delete-open" },
      { kind: "page", href: "/profile/danger-zone#account-delete-open" },
      { kind: "page", href: "/profile/security#totp-disable" },
      { kind: "page", href: "/profile/security#totp-disable" },
      { kind: "page", href: "/profile/security#sessions-end-others" },
      { kind: "page", href: "/profile/security#sessions-end-others" },
    ])
  })

  it("lists Turn off two-factor sign-in only while two-factor is on, and never for a guest", async () => {
    const offered = async (props: Partial<SearchPaletteProps>) => {
      await mount(props)
      await open()
      await type("two-factor")
      const found = listed().includes("Turn off two-factor sign-in | Account")
      await act(() => render(null, root!))
      return found
    }
    expect(await offered({ twoFactor: true })).toBe(true)
    expect(await offered({})).toBe(false)
    expect(await offered({ twoFactor: true, guest: true })).toBe(false)
  })

  it("lists Delete my account and Sign out of all other devices for a guest too", async () => {
    await mount({ guest: true })
    await open()
    await type(">")
    expect(listed()).toEqual(expect.arrayContaining([
      "Delete my account",
      "Sign out of all other devices",
    ]))
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

  it("shows a failed note search under Notes, in a dimmed row, and still lists the commands", async () => {
    await mount(
      {},
      (query) => query === "" ? { notes: [], onDevice: false } : Promise.reject(new Error("429")),
    )
    await open()

    await type("new")

    const failed = "Could not search. Change your search to try again."
    expect(listed().slice(-2)).toEqual(["# Notes", failed])
    expect(find("[data-e2e=search] [role=option][aria-disabled=true]").textContent).toBe(failed)
    expect(listed()).toContain(`New note | In Home`)
  })

  it("says a failed note search for typed text in a live region inside the palette, and clears it once a search works", async () => {
    await mount(
      {},
      (query) =>
        query === "" || query === "new"
          ? Promise.reject(new Error("429"))
          : { notes: [PLAN], onDevice: false },
    )
    await open()
    // Inside the dialog: the page outside an open modal dialog is inert, so unheard.
    const said = () =>
      find("[data-e2e=search] [role=status][data-e2e=search-notes-status]").textContent
    // The empty query lists no error row, so nothing is said either.
    expect(said()).toBe("")

    await type("new")
    expect(said()).toBe("Could not search. Change your search to try again.")

    await type("plan")
    expect(listed()).toContain("Weekly plan | Home · …call the bank…")
    expect(said()).toBe("")
  })

  it("draws the app's shortcut keys, a g sequence among them, without failing", async () => {
    await mount({
      shortcuts: [
        { keys: "n", description: "Shortcuts.newNoteRow", group: "General" },
        { keys: "g n", description: "Frame.notes", group: "Go to" },
      ],
    })
    await open()
    await type(">")
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
    /** Clicks the row whose label is `label`. */
    const pick = async (label: string) => {
      const row = [...document.querySelectorAll("[role=option]")]
        .find((candidate) => text(candidate).split(" | ")[0] === label)!
      await act(() => {
        row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }) as unknown as Event)
      })
      await settle()
    }
    await open()
    await type("color scheme")

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

describe("SearchPalette records", () => {
  const SAVINGS = { id: "a1", label: "Savings account", detail: "$1,200", href: "/accounts/a1" }
  const CARD = { id: "a2", label: "Credit card", aliases: ["Visa"], href: "/accounts/a2" }
  const accounts = (records: PaletteRecord[] = [SAVINGS, CARD], limit?: number) => ({
    heading: "Accounts",
    records: () => records,
    limit,
  })
  /** The rows listed under `heading`. */
  const under = (heading: string) => {
    const rows = listed()
    const start = rows.indexOf(`# ${heading}`)
    if (start === -1) return []
    const end = rows.findIndex((row, index) => index > start && row.startsWith("# "))
    return rows.slice(start + 1, end === -1 ? undefined : end)
  }
  const pick = async (label: string) => {
    const row = [...document.querySelectorAll("[role=option]")]
      .find((candidate) => text(candidate).startsWith(label))!
    await act(() => {
      row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }) as unknown as Event)
    })
  }

  it("finds a record by a typo, by its alias and typed in the other keyboard layout", async () => {
    await mount({ records: [accounts()] })
    await open()

    await type("savngs")
    expect(under("Accounts")).toEqual(["Savings account | $1,200"])
    await type("visa")
    expect(under("Accounts")).toEqual(["Credit card"])
    // "savings" typed on a Russian (ЙЦУКЕН) layout.
    await type("ыфмштпы")
    expect(under("Accounts")).toEqual(["Savings account | $1,200"])
  })

  it("lists a source after the commands and before Create, even when its record matches best", async () => {
    await mount({ records: [accounts([{ id: "t", label: "Theme", href: "/accounts/t" }])] })
    await open()
    await type("theme")

    const headings = listed().filter((row) => row.startsWith("# "))
    expect(headings.slice(-3)).toEqual(["# Commands", "# Accounts", "# Create"])
  })

  it("opens a picked record's page", async () => {
    const { picked } = await mount({ records: [accounts()] })
    await open()
    await type("credit")
    await pick("Credit card")

    expect(picked).toEqual([{ kind: "page", href: "/accounts/a2" }])
  })

  it("lists no records for the empty query, nor for punctuation alone", async () => {
    await mount({ records: [accounts()] })
    await open()
    expect(listed()).not.toContain("# Accounts")

    await type("!!!")
    expect(listed()).not.toContain("# Accounts")
  })

  it("adds no heading for a source without a matching record", async () => {
    await mount({
      records: [accounts(), { heading: "Invoices", records: () => [] }, {
        heading: "Budgets",
        records: () => [{ id: "b1", label: "Groceries", href: "/budgets/b1" }],
      }],
    })
    await open()
    await type("savings")

    expect(under("Accounts")).toEqual(["Savings account | $1,200"])
    expect(listed()).not.toContain("# Invoices")
    expect(listed()).not.toContain("# Budgets")
  })

  it("lists at most five rows of a source, or its own limit, best first", async () => {
    const rents = Array.from({ length: 8 }, (_, index) => ({
      id: `r${index}`,
      label: `Rental ${index}`,
      href: `/accounts/r${index}`,
    }))
    rents.push({ id: "exact", label: "Rent", href: "/accounts/exact" })
    await mount({ records: [accounts(rents), { ...accounts(rents, 2), heading: "Rent again" }] })
    await open()
    await type("rent")

    expect(under("Accounts")).toEqual(["Rent", "Rental 0", "Rental 1", "Rental 2", "Rental 3"])
    expect(under("Rent again")).toEqual(["Rent", "Rental 0"])
  })

  it("keeps rows of two sources apart when their records share an id", async () => {
    const { picked } = await mount({
      records: [accounts([SAVINGS]), {
        heading: "Goals",
        records: () => [{ id: SAVINGS.id, label: "Savings goal", href: "/goals/a1" }],
      }],
    })
    await open()
    await type("savings")
    expect(under("Accounts")).toEqual(["Savings account | $1,200"])
    expect(under("Goals")).toEqual(["Savings goal"])
    // The highlighted row is named by its element id, so no two rows may share one.
    const ids = [...document.querySelectorAll("[role=option]")].map((row) => row.id)
    expect(new Set(ids).size).toBe(ids.length)

    await pick("Savings goal")
    expect(picked).toEqual([{ kind: "page", href: "/goals/a1" }])
  })
})

describe("SearchPalette Recent", () => {
  const KEY = "palette-recent"
  /** A key-value store in memory, as the app's `browserStorage()` is. */
  const memory = (initial: Record<string, string> = {}) => {
    const entries = new Map(Object.entries(initial))
    return {
      entries,
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => void entries.set(key, value),
      removeItem: (key: string) => void entries.delete(key),
    }
  }
  const recentOf = (store: ReturnType<typeof memory>) => ({ storageKey: KEY, storage: () => store })
  const kept = (ids: readonly string[]) => memory({ [KEY]: JSON.stringify(ids) })
  /** The rows listed under "Recent", or none. */
  const recentRows = () => {
    const rows = listed()
    if (rows[0] !== "# Recent") return []
    const end = rows.findIndex((row, index) => index > 0 && row.startsWith("# "))
    return rows.slice(1, end === -1 ? undefined : end)
  }

  it("lists a Go to or Settings command picked before under Recent, once, with nothing typed", async () => {
    const store = memory()
    await mount({ recent: recentOf(store) })
    await open()
    await type("notifications")
    await enter()
    await open()

    expect(store.entries.get(KEY)).toBe(`["action-notifications"]`)
    expect(recentRows()).toEqual(["Notifications"])
    expect(listed().filter((row) => row === "Notifications")).toHaveLength(1)
    expect(listed()).not.toContain("# Go to")
  })

  it("lists a theme row picked before under Recent, with nothing typed", async () => {
    const store = memory()
    await mount({ recent: recentOf(store) })
    await open()
    await type("dark")
    await enter()

    await act(() => render(null, root!))
    await mount({ recent: recentOf(store) })
    await open()

    expect(recentRows()).toEqual(["Theme → Dark"])
    expect(listed().filter((row) => row.startsWith("Theme →"))).toHaveLength(1)
  })

  it("lists at most five recent picks, newest first, and no other heading for the rest", async () => {
    await mount({
      recent: recentOf(
        kept([
          `action-profile`,
          `action-shortcuts`,
          `note-${PLAN.id}`,
          `group-${STUDIO.id}`,
          `action-sign-out`,
          `action-notifications`,
        ]),
      ),
    })
    await open()

    expect(recentRows()).toEqual([
      "Profile",
      "Keyboard shortcuts",
      "Weekly plan | …call the bank…",
      "Acme Studio | Viewer",
      "Sign out",
    ])
    expect(listed().filter((row) => row.startsWith("# "))).toEqual([
      "# Recent",
      "# Notes",
      "# Create",
    ])
  })

  it("skips a recent pick that no row has any more", async () => {
    await mount({ recent: recentOf(kept([`action-gone`, `group-deleted`, `action-profile`])) })
    await open()

    expect(recentRows()).toEqual(["Profile"])
  })

  it("lists no Recent heading while storage refuses the read, holds broken JSON, or nothing is kept", async () => {
    const refusing = {
      storageKey: KEY,
      storage: () => {
        throw new DOMException("blocked", "SecurityError")
      },
    }
    for (const recent of [refusing, recentOf(memory({ [KEY]: "{not json" })), recentOf(memory())]) {
      await mount({ recent })
      await open()
      expect(listed()[0]).toBe("# Notes")
      await act(() => render(null, root!))
    }
  })

  it("reads the stored picks as strings only, and none from anything but an array", () => {
    const read = (raw: string) => storedRecent(recentOf(memory({ [KEY]: raw })))
    expect(read(`["a", 1, null, "b"]`)).toEqual(["a", "b"])
    expect(read(`{"a": 1}`)).toEqual([])
    expect(storedRecent(undefined)).toEqual([])
  })
})

describe("SearchPalette notes that answer at once", () => {
  it("lists them with the rest in one answer, the highlight on the first note", async () => {
    await mount({}, () => ({ notes: [{ ...PLAN, title: "Weekly tomato" }], onDevice: false }))
    await open()

    await type("tomato")
    await until(() => listed().includes("# Notes"))

    expect(listed()[0]).toBe("# Notes")
    expect(text(find("[data-e2e=search] [role=option][aria-selected=true]")))
      .toContain("Weekly tomato")
  })
})

describe("SearchPalette notes that answer late", () => {
  it("picks the note on an Enter pressed before a slow note search answered, not quick-create", async () => {
    const tomato = { ...PLAN, title: "Weekly tomato" }
    const { picked } = await mount(
      {},
      (query) =>
        query === ""
          ? { notes: [], onDevice: false }
          : new Promise((resolve) =>
            setTimeout(() => resolve({ notes: [tomato], onDevice: false }), 300)
          ),
    )
    await open()

    await fill("tomato")
    await enter()
    await act(() => new Promise((resolve) => setTimeout(resolve, 800)))

    expect(picked).toEqual([{ kind: "note", noteId: tomato.id, groupId: tomato.groupId }])
  })
})
