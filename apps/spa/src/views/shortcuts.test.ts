import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import {
  GROUP_PATHS,
  NOTE_PATHS,
  OVERVIEW_PATHS,
  SCREEN_PATHS,
  TAG_PATHS,
} from "@ui/progressive.tsx"
import { SHORTCUT_GROUPS } from "@ui/shortcuts.tsx"
import { createTranslator } from "@spy4x/platform/universal/i18n"
import app from "@i18n/app/en.ts"
import appRu from "@i18n/app/ru.ts"
import { paletteCommands, type PaletteOption } from "@ui/palette-commands.ts"
import { pageCommands, spaShortcutRows } from "./shortcuts.ts"

function rows(activityGroupId: string | null, onOverview = false) {
  const seen = { navigated: [] as string[], newNote: 0, shortcuts: 0, range: 0, customise: 0 }
  const list = spaShortcutRows({
    navigate: (href) => void seen.navigated.push(href),
    openShortcuts: () => void seen.shortcuts++,
    openNewNote: () => void seen.newNote++,
    activityGroupId,
    overviewPage: onOverview
      ? { openRange: () => void seen.range++, openCustomise: () => void seen.customise++ }
      : null,
  })
  return { list, seen }
}

describe("SPA keyboard shortcuts", () => {
  it("goes to each section with its g sequence", () => {
    const { list, seen } = rows("0190a000-0000-7000-8000-000000000001")
    const goTo = list.filter((row) => row.keys.startsWith("g "))
    expect(goTo.map((row) => row.keys)).toEqual(["g o", "g n", "g t", "g a", "g g", "g i", "g p"])
    for (const row of goTo) row.run!()
    expect(seen.navigated).toEqual([
      OVERVIEW_PATHS.root,
      NOTE_PATHS.list,
      TAG_PATHS.list,
      GROUP_PATHS.activity("0190a000-0000-7000-8000-000000000001"),
      SCREEN_PATHS.groups,
      SCREEN_PATHS.notifications,
      SCREEN_PATHS.profile,
    ])
  })

  it("lists Activity only while the rail shows it", () => {
    expect(rows(null).list.some((row) => row.keys === "g a")).toBe(false)
  })

  it("opens New note with n and the list with ?", () => {
    const { list, seen } = rows(null)
    list.find((row) => row.keys === "n")!.run!()
    list.find((row) => row.keys === "?")!.run!()
    expect(seen).toEqual({ navigated: [], newNote: 1, shortcuts: 1, range: 0, customise: 0 })
  })

  it("opens the range picker with d and Customise with c while the overview is open", () => {
    const { list, seen } = rows(null, true)
    const page = list.filter((row) => row.group === SHORTCUT_GROUPS.page)
    expect(page.map((row) => [row.keys, row.description])).toEqual([
      ["d", `Shortcuts.dateRange`],
      ["c", `Shortcuts.customise`],
    ])
    for (const row of page) row.run!()
    expect(seen).toMatchObject({ range: 1, customise: 1 })
  })

  it("binds neither d nor c on another page", () => {
    const keys = rows(null).list.map((row) => row.keys)
    expect(keys).not.toContain("d")
    expect(keys).not.toContain("c")
  })

  it("lists search's keys, Undo's and the New note dialog's without binding them here", () => {
    const listed = rows(null).list.filter((row) => !row.run).map((row) => row.keys)
    expect(listed).toEqual(["mod+k", "/", "mod+z", "esc", "enter", "mod+enter"])
  })
})

/** The `app` catalog in Russian, as the SPA reads it for a person who chose Russian. */
const RU = createTranslator({ language: `ru`, catalogs: [{ source: app, translation: appRu }] })

describe("the open page's commands in the search palette", () => {
  it("label the overview's commands in the person's language and keep their English as aliases", () => {
    expect(pageCommands(RU, { overview: true, benchmark: false, noteEditor: false }, [])).toEqual([
      {
        id: "overview-range",
        label: RU.t(`Shortcuts.dateRange`),
        aliases: ["Change date range"],
        kbd: undefined,
      },
      {
        id: "overview-customise",
        label: RU.t(`Shortcuts.customise`),
        aliases: ["Customise overview"],
        kbd: undefined,
      },
    ])
    expect(RU.t(`Shortcuts.dateRange`)).not.toBe("Change date range")
  })

  it("offer the note page's attach command, and nothing on another page", () => {
    expect(
      pageCommands(RU, { overview: false, benchmark: false, noteEditor: true }, [])
        ?.map((c) => c.aliases),
    ).toEqual([["Attach files to this note"]])
    expect(pageCommands(RU, { overview: false, benchmark: false, noteEditor: false }, []))
      .toBeUndefined()
  })
})

const EN = createTranslator({ language: `en`, catalogs: [{ source: app }] })

/** The palette's commands, with every submenu's rows, for the shortcut rows of one page. */
function commandsFor(page: "none" | "overview" | "benchmark") {
  const navigated: string[] = []
  const list = spaShortcutRows({
    navigate: (href) => void navigated.push(href),
    openShortcuts: () => {},
    openNewNote: () => {},
    activityGroupId: "0190a000-0000-7000-8000-000000000001",
    overviewPage: page === "overview" ? { openRange: () => {}, openCustomise: () => {} } : null,
    benchmarkPage: page === "benchmark" ? { run: () => {}, copy: () => {} } : null,
  })
  const open = { overview: page === "overview", benchmark: page === "benchmark", noteEditor: false }
  const commands = paletteCommands({
    t: EN,
    locale: `en`,
    currentGroup: { id: "0190a000-0000-7000-8000-000000000001", name: "Home", canWrite: true },
    online: true,
    theme: () => `system`,
    shortcuts: list,
    activityGroupId: "0190a000-0000-7000-8000-000000000001",
    pageCommands: pageCommands(EN, open, list) ?? [],
    guest: false,
    benchmark: true,
    canInstall: false,
  }, () => {})
  const flat = (options: readonly PaletteOption[]): PaletteOption[] =>
    options.flatMap((option) => [option, ...flat(option.children ?? [])])
  return { list, navigated, commands: flat(commands) }
}

describe("the palette and the keyboard shortcuts", () => {
  for (const page of ["none", "overview", "benchmark"] as const) {
    it(`has a command for the keys of every shortcut that acts (page: ${page})`, () => {
      const { list, commands } = commandsFor(page)
      const missing = list.filter((row) => row.run)
        .filter((row) => !commands.some((command) => command.shortcut === row.keys))
        .map((row) => `${row.keys} (${row.description})`)
      expect(missing).toEqual([])
    })
  }

  it("shows a single key press on its command and keeps a g sequence off it", () => {
    const { commands } = commandsFor("none")
    const keysOf = (label: string) => {
      const command = commands.find((command) => command.label === label)
      return [command?.kbd, command?.shortcut]
    }
    expect([keysOf("New note"), keysOf("Notes")]).toEqual([["n", "n"], [undefined, "g n"]])
  })

  it("opens the same page from each Go to command as from its g shortcut", () => {
    const { list, navigated, commands } = commandsFor("none")
    for (const row of list.filter((row) => row.keys.startsWith("g "))) {
      row.run!()
      const command = commands.find((command) => command.shortcut === row.keys)
      expect(command?.choice, row.keys).toEqual({ kind: "page", href: navigated.at(-1) })
    }
  })
})
