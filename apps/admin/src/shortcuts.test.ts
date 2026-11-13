import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { adminPaletteCommands, type AdminPaletteOption } from "@ui/admin-palette-commands.ts"
import { SHORTCUT_GROUPS } from "@ui/shortcuts.tsx"
import { ADMIN_MODULES, shownModules } from "./modules/registry.ts"
import type { AdminModule } from "./modules/types.ts"
import { ADMIN_PAGE_ACTIONS, adminGoTo, adminShortcutRows, onListPage } from "./shortcuts.ts"
import { adminText } from "./i18n.ts"

/** The blog's own pages' `g` sequences, next to the modules'. */
const BLOG_PAGE_KEYS = new Set(["g h", "g n"])

function rows(path: string, modules = ADMIN_MODULES) {
  const seen = { navigated: [] as string[], filters: 0, shortcuts: 0 }
  const list = adminShortcutRows({
    modules,
    t: adminText(),
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
    const goTo = list.filter((row) => row.keys.startsWith("g ") && !BLOG_PAGE_KEYS.has(row.keys))
    expect(goTo.map((row) => row.description)).toEqual(
      ADMIN_MODULES.map((m) => adminText().t(m.nav.name)),
    )
    const keys = list.filter((row) => row.keys.startsWith("g ")).map((row) => row.keys)
    expect(new Set(keys).size).toBe(keys.length)
    for (const row of goTo) row.run!()
    expect(seen.navigated).toEqual(ADMIN_MODULES.map((m) => m.nav.href))
  })

  it("opens the sharing channels with g h and the posts that need sharing with g n, while the blog is shown", () => {
    const { list, seen } = rows("/")
    list.find((row) => row.keys === "g h")!.run!()
    list.find((row) => row.keys === "g n")!.run!()
    expect(seen.navigated).toEqual(["/blog/channels", "/blog?sharing=todo"])
    const noBlog = ADMIN_MODULES.filter((module) => module.id !== "blog")
    expect(rows("/", noBlog).list.some((row) => BLOG_PAGE_KEYS.has(row.keys))).toBe(false)
  })

  it("adds a channel with c on the channels page, and lists the checklist's row keys there only", () => {
    const channels = rows("/blog/channels")
    channels.list.find((row) => row.keys === "c")!.run!()
    expect(channels.seen.navigated).toEqual(["/blog/channels/new"])
    expect(channels.list.some((row) => row.keys === "mod+s" || row.keys === "f8")).toBe(false)
    const checklist = rows("/blog/0195f0b4-3c1e-7a00-8000-000000000001/sharing").list
    expect(checklist.filter((row) => row.keys.length === 1).map((row) => row.keys))
      .toEqual(expect.arrayContaining(["j", "k", "t", "o", "p", "s", "e"]))
    expect(rows("/blog/0195f0b4-3c1e-7a00-8000-000000000001").list.some((row) => row.keys === "j"))
      .toBe(false)
  })

  it("lists the g sequences of the modules shown, in the rail's order", () => {
    const shown = ADMIN_MODULES.slice(0, 2)
    const goTo = rows("/", shown).list.filter((row) => row.keys.startsWith("g "))
    expect(goTo.map((row) => row.description)).toEqual(shown.map((m) => adminText().t(m.nav.name)))
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

  it("lists F8 and Shift F8 in the blog's editor and nowhere else", () => {
    const listed = (path: string) =>
      rows(path).list.filter((row) => row.keys === "f8" || row.keys === "shift+f8").length
    expect(listed("/blog/new")).toBe(2)
    expect(listed("/blog/0195f0b4-3c1e-7a00-8000-000000000001")).toBe(2)
    expect(listed("/blog")).toBe(0)
    expect(listed("/catalog/0195f0b4-3c1e-7a00-8000-000000000001")).toBe(0)
  })

  it("lists Ctrl K, which the palette binds itself", () => {
    const row = rows("/").list.find((row) => row.keys === "mod+k")
    expect([row?.description, row?.run]).toEqual([`Shortcuts.search`, undefined])
  })
})

/** The palette's commands, with every submenu's rows, for the shortcut rows of one page. */
function commandsFor(path: string, modules: readonly AdminModule[] = ADMIN_MODULES) {
  const { list, seen } = rows(path, modules)
  const commands = adminPaletteCommands({
    t: adminText(),
    goTo: adminGoTo(modules),
    listFilter: onListPage(modules, path),
    theme: () => `system`,
    singleKeys: () => true,
  }, () => {})
  const flat = (options: readonly AdminPaletteOption[]): AdminPaletteOption[] =>
    options.flatMap((option) => [option, ...flat(option.children ?? [])])
  return { list, seen, commands: flat(commands) }
}

describe("the admin palette and the keyboard shortcuts", () => {
  // The open page's own actions (`c`: New post, Add link…) get their commands in spy4x/seed#1000.
  const pageActions = new Set(
    Object.values(ADMIN_PAGE_ACTIONS).flat().map((action) => adminText().t(action.description)),
  )
  for (const path of ["/", "/users", "/blog", "/blog/channels", "/catalog", "/users/7"]) {
    it(`has a command for the keys of every shortcut that acts (page: ${path})`, () => {
      const { list, commands } = commandsFor(path)
      const missing = list.filter((row) => row.run)
        .filter((row) => !(row.group === SHORTCUT_GROUPS.page && pageActions.has(row.description)))
        .filter((row) => !commands.some((command) => command.shortcut === row.keys))
        .map((row) => `${row.keys} (${row.description})`)
      expect(missing).toEqual([])
    })
  }

  it("opens the same page from each Go to command as from its g shortcut", () => {
    const { list, seen, commands } = commandsFor("/")
    const goTo = list.filter((row) => row.keys.startsWith("g "))
    expect(goTo.length).toBe(ADMIN_MODULES.length + BLOG_PAGE_KEYS.size)
    for (const row of goTo) {
      row.run!()
      const command = commands.find((command) => command.shortcut === row.keys)
      expect(command?.choice, row.keys).toEqual({ kind: "page", href: seen.navigated.at(-1) })
    }
  })

  it("has no command for an optional module that is off, nor for the blog's pages without it", () => {
    const ids = (modules: readonly AdminModule[]) =>
      commandsFor("/", modules).commands.map((command) => command.id)
    const off = shownModules(ADMIN_MODULES, new Set())
    expect(ids(off)).not.toContain(`action-go-catalog`)
    expect(ids(shownModules(ADMIN_MODULES, new Set([`catalog`])))).toContain(`action-go-catalog`)
    const noBlog = ADMIN_MODULES.filter((module) => module.id !== `blog`)
    expect(ids(noBlog).filter((id) => id.startsWith(`action-go-blog`))).toEqual([])
  })

  it("offers Search this list only where / focuses a list's search field", () => {
    const has = (path: string) =>
      commandsFor(path).commands.some((command) => command.choice?.kind === `list-filter`)
    expect([has("/users"), has("/blog"), has("/"), has("/users/7")]).toEqual([
      true,
      true,
      false,
      false,
    ])
  })
})
