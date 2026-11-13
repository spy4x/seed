/**
 * The SPA palette's command registry, ranked by the palette's own `matchOptions` as `SearchPalette`
 * ranks it: which commands a person finds by which words, which are offered when, and what a pick
 * asks the app to do.
 */
import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { matchOptions } from "@spy4x/preact-ui/command-palette"
import { createTranslator } from "@spy4x/platform/universal/i18n"
import type { ThemePreference } from "@domain/identity"
import app from "@i18n/app/en.ts"
import appRu from "@i18n/app/ru.ts"
import {
  groupRow,
  paletteCommands,
  type PaletteContext,
  type PaletteOption,
  pickedChoice,
  type SearchChoice,
} from "./palette-commands.ts"

const EN = createTranslator({ language: `en`, catalogs: [{ source: app }] })
const RU = createTranslator({ language: `ru`, catalogs: [{ source: app, translation: appRu }] })
const HOME = { id: `0190a000-0000-7000-8000-000000000001`, name: `Home`, canWrite: true }

function context(overrides: Partial<PaletteContext> = {}): PaletteContext {
  return {
    t: EN,
    locale: `en`,
    currentGroup: HOME,
    online: true,
    theme: () => `system`,
    shortcuts: [],
    activityGroupId: null,
    pageCommands: [],
    guest: false,
    benchmark: false,
    canInstall: false,
    ...overrides,
  }
}

/** The label of the first command `query` finds. */
function top(query: string, overrides: Partial<PaletteContext> = {}): string | undefined {
  return matchOptions(paletteCommands(context(overrides), () => {}), query)[0]?.label
}

function labels(overrides: Partial<PaletteContext> = {}): string[] {
  return paletteCommands(context(overrides), () => {}).map((option) => option.label)
}

describe(`the palette's commands`, () => {
  it(`put Theme first for dark, тема, ntvf (тема on the English layout) and darkk`, () => {
    for (const query of [`dark`, `тема`, `ntvf`, `darkk`]) expect(top(query), query).toBe(`Theme`)
    expect(top(`dark`, { t: RU }), `dark in Russian`).toBe(`Тема`)
  })

  it(`put Go to Notes first for notse and заметки`, () => {
    for (const query of [`notse`, `заметки`]) {
      const found = matchOptions(paletteCommands(context(), () => {}), query)[0]
      expect([found?.label, found?.choice], query).toEqual([
        `Notes`,
        { kind: `page`, href: `/notes` },
      ])
    }
  })

  it(`offer one Settings command per profile section, each opening its page`, () => {
    const hrefs = paletteCommands(context(), () => {})
      .filter((option) => option.group === `Settings` && option.choice?.kind === `page`)
      .map((option) => (option.choice as { href: string }).href)
    for (
      const section of [
        `account`,
        `region`,
        `security`,
        `appearance`,
        `api-tokens`,
        `notifications`,
        `danger-zone`,
      ]
    ) expect(hrefs).toContain(`/profile/${section}`)
  })

  it(`find Theme and every profile section by settings and настройки`, () => {
    for (const query of [`settings`, `настройки`]) {
      const found = matchOptions(paletteCommands(context(), () => {}), query).map((option) =>
        option.id
      )
      expect(found, query).toContain(`action-theme`)
      for (const section of [`account`, `security`, `region`, `appearance`, `danger-zone`]) {
        expect(found, `${query} ${section}`).toContain(`action-settings-${section}`)
      }
    }
  })

  it(`offer Activity only while the rail shows it, and opens that group's`, () => {
    expect(labels()).not.toContain(`Activity`)
    const activity = paletteCommands(context({ activityGroupId: HOME.id }), () => {})
      .find((option) => option.label === `Activity`)
    expect(activity?.choice).toEqual({ kind: `page`, href: `/groups/${HOME.id}/activity` })
  })

  it(`offer Install app only while the browser offers an install`, () => {
    expect(labels()).not.toContain(`Install app`)
    const install = paletteCommands(context({ canInstall: true }), () => {})
      .find((option) => option.label === `Install app`)
    expect(install?.choice).toEqual({ kind: `install` })
  })

  it(`keep New group listed offline, dimmed with why it cannot run`, () => {
    const newGroup = (online: boolean) =>
      paletteCommands(context({ online }), () => {}).find((option) => option.label === `New group`)
    expect(newGroup(true)?.disabledReason).toBeUndefined()
    expect(newGroup(false)?.disabledReason).toBe(`Needs a connection`)
  })

  it(`ask the app to sign out through its own sign-out, never directly`, () => {
    const signOut = paletteCommands(context(), () => {})
      .find((option) => option.label === `Sign out`)
    expect([signOut?.choice, signOut?.run]).toEqual([{ kind: `sign-out` }, undefined])
  })

  it(`show each Theme row's state from the theme chosen now, and pick it with the palette open`, () => {
    let theme: ThemePreference = `system`
    const picked: SearchChoice[] = []
    const themeCommand = paletteCommands(
      context({ theme: () => theme }),
      (choice) => void picked.push(choice),
    ).find((option) => option.label === `Theme`)!
    const dark = themeCommand.children!.find((option) => option.label === `Dark`)!
    expect([themeCommand.state, dark.state, dark.keepOpen]).toEqual([`System`, undefined, true])

    dark.run!({ alternative: false })
    theme = `dark`

    expect(picked).toEqual([{ kind: `theme`, theme: `dark` }])
    expect([themeCommand.state, dark.state]).toEqual([`Dark`, `Current`])
  })
})

describe(`a group row`, () => {
  const row: PaletteOption = groupRow(EN, { id: HOME.id, name: `Acme Studio` }, `Owner`, false)

  it(`switches to the group on Enter and opens its settings on Ctrl Enter`, () => {
    expect(pickedChoice(row.choice!, false)).toEqual({ kind: `switch-group`, groupId: HOME.id })
    expect(pickedChoice(row.choice!, true)).toEqual({ kind: `group-settings`, groupId: HOME.id })
    expect(pickedChoice({ kind: `new-note` }, true)).toEqual({ kind: `new-note` })
  })

  it(`is found by "switch to" and its name`, () => {
    expect(matchOptions([row], `switch to acme`)).toEqual([row])
  })
})
