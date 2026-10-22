import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import {
  GROUP_PATHS,
  NOTE_PATHS,
  OVERVIEW_PATHS,
  SCREEN_PATHS,
  TAG_PATHS,
} from "@ui/progressive.tsx"
import { spaShortcutRows } from "./shortcuts.ts"

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
    const page = list.filter((row) => row.group === "This page")
    expect(page.map((row) => [row.keys, row.description])).toEqual([
      ["d", "Change date range"],
      ["c", "Customise overview"],
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
