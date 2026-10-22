import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { ADMIN_MODULES } from "./modules/registry.ts"
import { adminShortcutRows } from "./shortcuts.ts"

function rows(path: string, modules = ADMIN_MODULES) {
  const seen = { navigated: [] as string[], filters: 0, shortcuts: 0 }
  const list = adminShortcutRows({
    modules,
    path,
    navigate: (href) => void seen.navigated.push(href),
    openShortcuts: () => void seen.shortcuts++,
    focusListFilter: () => void seen.filters++,
  })
  return { list, seen }
}

describe("admin keyboard shortcuts", () => {
  it("has one distinct g sequence per module, named and aimed as its rail entry", () => {
    const { list, seen } = rows("/")
    const goTo = list.filter((row) => row.keys.startsWith("g "))
    expect(goTo.map((row) => row.description)).toEqual(ADMIN_MODULES.map((m) => m.nav.name))
    expect(new Set(goTo.map((row) => row.keys)).size).toBe(goTo.length)
    for (const row of goTo) row.run!()
    expect(seen.navigated).toEqual(ADMIN_MODULES.map((m) => m.nav.href))
  })

  it("lists the g sequences of the modules shown, in the rail's order", () => {
    const shown = ADMIN_MODULES.slice(0, 2)
    const goTo = rows("/", shown).list.filter((row) => row.keys.startsWith("g "))
    expect(goTo.map((row) => row.description)).toEqual(shown.map((m) => m.nav.name))
  })

  it("binds / to the list's search only on a list page", () => {
    const users = ADMIN_MODULES.find((module) => module.id === "users")!
    const onList = rows(users.nav.href)
    const slash = onList.list.find((row) => row.keys === "/")!
    slash.run!()
    expect(onList.seen.filters).toBe(1)
    expect(rows(`${users.nav.href}/some-person`).list.some((row) => row.keys === "/")).toBe(false)
    const dashboard = ADMIN_MODULES.find((module) => module.id === "dashboard")!
    expect(rows(dashboard.nav.href).list.some((row) => row.keys === "/")).toBe(false)
  })

  it("opens the list with ? and has no New note", () => {
    const { list, seen } = rows("/")
    list.find((row) => row.keys === "?")!.run!()
    expect(seen.shortcuts).toBe(1)
    expect(list.some((row) => row.keys === "n" || row.description.includes("note"))).toBe(false)
  })

  it("writes a new post with c on the blog's list only", () => {
    const onList = rows("/blog")
    onList.list.find((row) => row.keys === "c")!.run!()
    expect(onList.seen.navigated).toEqual(["/blog/new"])
    expect(rows("/blog/new").list.some((row) => row.keys === "c")).toBe(false)
    expect(rows("/users").list.some((row) => row.keys === "c")).toBe(false)
  })

  it("binds / to the blog list's search", () => {
    const onList = rows("/blog")
    onList.list.find((row) => row.keys === "/")!.run!()
    expect(onList.seen.filters).toBe(1)
  })

  it("lists Ctrl S in the blog's editor and nowhere else", () => {
    const listed = (path: string) => rows(path).list.some((row) => row.keys === "mod+s")
    expect(listed("/blog/new")).toBe(true)
    expect(listed("/blog/0195f0b4-3c1e-7a00-8000-000000000001")).toBe(true)
    expect(listed("/blog")).toBe(false)
    expect(listed("/users/7")).toBe(false)
  })
})
