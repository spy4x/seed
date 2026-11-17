/**
 * The SPA palette's command registry, ranked by the palette's own `matchCommands` as `SearchPalette`
 * ranks it: which commands a person finds by which words, which are offered when, and what a pick
 * asks the app to do.
 */
import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { createTranslator } from "@spy4x/platform/universal/i18n"
import type { CommandPaletteOption } from "@spy4x/preact-ui/command-palette"
import type { ThemePreference } from "@domain/identity"
import app from "@i18n/app/en.ts"
import appRu from "@i18n/app/ru.ts"
import {
  groupRow,
  matchCommands,
  paletteCommands,
  type PaletteContext,
  type PaletteOption,
  pickedChoice,
  quickCreateRows,
  type SearchChoice,
  themeRows,
  withRun,
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
  return matchCommands(paletteCommands(context(overrides), () => {}), query)[0]?.label
}

function labels(overrides: Partial<PaletteContext> = {}): string[] {
  return paletteCommands(context(overrides), () => {}).map((option) => option.label)
}

describe(`the palette's commands`, () => {
  it(`put Theme first for dark, тема, ntvf (тема on the English layout) and darkk`, () => {
    for (const query of [`dark`, `тема`, `ntvf`, `darkk`]) expect(top(query), query).toBe(`Theme`)
    expect(top(`dark`, { t: RU }), `dark in Russian`).toBe(`Тема`)
  })

  it(`find a command in Russian by its English label and detail, which are not aliases`, () => {
    const commands = paletteCommands(context({ t: RU }), () => {})
    const first = (query: string) => matchCommands(commands, query)[0]?.id
    expect(first(`new note`)).toBe(`action-new-note`)
    expect(first(`theme`)).toBe(`action-theme`)
    expect(matchCommands(commands, `in home`).map((option) => option.id))
      .toContain(`action-new-tag`)
    for (const option of commands) {
      for (const word of option.englishWords ?? []) {
        expect(option.aliases ?? [], option.id).not.toContain(word)
      }
    }
  })

  it(`return the rows themselves from matchCommands, so a row's state is read when drawn`, () => {
    let state = `On`
    const row: PaletteOption = {
      id: `action-switch`,
      label: `Переключатель`,
      englishWords: [`Switch`],
      get state() {
        return state
      },
    }
    const [found] = matchCommands([row], `switch`)
    state = `Off`
    expect(found?.state).toBe(`Off`)
  })

  it(`put Go to Notes first for notse and заметки`, () => {
    for (const query of [`notse`, `заметки`]) {
      const found = matchCommands(paletteCommands(context(), () => {}), query)[0]
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
      const found = matchCommands(paletteCommands(context(), () => {}), query).map((option) =>
        option.id
      )
      expect(found, query).toContain(`action-theme`)
      for (const section of [`account`, `security`, `region`, `appearance`, `danger-zone`]) {
        expect(found, `${query} ${section}`).toContain(`action-settings-${section}`)
      }
    }
  })

  it(`offer no API tokens setting with the notes off, and every other section`, () => {
    const settings = (notes?: boolean) =>
      paletteCommands(context({ notes }), () => {})
        .filter((option) => option.group === `Settings` && option.choice?.kind === `page`)
        .map((option) => option.id)
    const on = settings()

    expect(on).toContain(`action-settings-api-tokens`)
    expect(settings(false)).toEqual(on.filter((id) => id !== `action-settings-api-tokens`))
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

  it(`keep each command the server must run listed offline, dimmed with why, and dim none online`, () => {
    // A guest gets Keep your account; Turn off two-factor sign-in is listed only for a member.
    const dimmed = (online: boolean) =>
      [{ guest: true }, { twoFactor: true }].flatMap((extra) =>
        paletteCommands(context({ online, canInstall: true, benchmark: true, ...extra }), () => {})
          .filter((option) => option.disabledReason !== undefined)
          .map((option) => `${option.label}: ${option.disabledReason}`)
      )
    expect(new Set(dimmed(false))).toEqual(
      new Set([
        `Import notes`,
        `New group`,
        `Keep your account`,
        `Download my data`,
        `Change profile picture`,
        `Delete my account`,
        `Turn off two-factor sign-in`,
        `Sign out of all other devices`,
      ].map((label) => `${label}: Needs a connection`)),
    )
    expect(dimmed(true)).toEqual([])
  })

  it(`offer Import notes to an editor with the notes on, opening the notes picker`, () => {
    const importNotes = (overrides: Partial<PaletteContext> = {}) =>
      paletteCommands(context(overrides), () => {}).find((o) => o.label === `Import notes`)
    expect(importNotes()?.choice).toEqual({ kind: `page`, href: `/imports/new?kind=notes` })
    expect(top(`import csv`)).toBe(`Import notes`)
    expect(importNotes({ online: false })?.disabledReason).toBe(`Needs a connection`)
    expect(importNotes({ currentGroup: { ...HOME, canWrite: false } })).toBeUndefined()
    expect(importNotes({ notes: false })).toBeUndefined()
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
    expect(matchCommands([row], `switch to acme`)).toEqual([row])
  })
})

describe(`the quick-create rows`, () => {
  /** Each row's label, detail and why it cannot run, for `query` in `overrides`' state. */
  const rows = (query: string, overrides: Partial<PaletteContext> = {}) =>
    quickCreateRows(context(overrides), query).map((
      row,
    ) => [row.label, row.detail ?? null, row.disabledReason ?? null])
  const shown = (text: string) => `\u2068${text}\u2069`

  it(`offer a note, a tag and a group named after the trimmed query, under Create`, () => {
    const made = quickCreateRows(context(), `  groceries `)
    expect(rows(`  groceries `)).toEqual([
      [`New note: “${shown(`groceries`)}”`, `In Home`, null],
      [`New tag: “${shown(`groceries`)}”`, `In Home`, null],
      [`New group: “${shown(`groceries`)}”`, null, null],
    ])
    expect(made.map((row) => [row.group, row.choice])).toEqual([
      [`Create`, { kind: `quick-create`, entity: `note`, title: `groceries` }],
      [`Create`, { kind: `quick-create`, entity: `tag`, title: `groceries` }],
      [`Create`, { kind: `quick-create`, entity: `group`, title: `groceries` }],
    ])
  })

  it(`are not offered for an empty query or one of spaces only`, () => {
    expect([rows(``), rows(` \t `)]).toEqual([[], []])
  })

  it(`offer only the group without a current group, in a read-only group, and with the notes off`, () => {
    const groupOnly = [[`New group: “${shown(`milk`)}”`, null, null]]
    expect(rows(`milk`, { currentGroup: null })).toEqual(groupOnly)
    expect(rows(`milk`, { currentGroup: { ...HOME, canWrite: false } })).toEqual(groupOnly)
    expect(rows(`milk`, { notes: false })).toEqual(groupOnly)
  })

  it(`keep the group listed offline, dimmed with why it cannot run, and the note and tag as they are`, () => {
    expect(rows(`milk`, { online: false })).toEqual([
      [`New note: “${shown(`milk`)}”`, `In Home`, null],
      [`New tag: “${shown(`milk`)}”`, `In Home`, null],
      [`New group: “${shown(`milk`)}”`, null, `Needs a connection`],
    ])
  })

  it(`show at most forty characters of the text but hand back all of it`, () => {
    const long = `${`a`.repeat(39)}🛒🛒 tail`
    const [note] = quickCreateRows(context(), long)
    expect(note.label).toBe(`New note: “${shown(`${`a`.repeat(39)}🛒…`)}”`)
    expect(note.choice).toEqual({ kind: `quick-create`, entity: `note`, title: long })
  })

  it(`end a cut text at its last word, with no space before the "…"`, () => {
    const [note] = quickCreateRows(context(), `${`a`.repeat(34)} trip and more`)
    expect(note.label).toBe(`New note: “${shown(`${`a`.repeat(34)} trip…`)}”`)
  })

  it(`use the language's own quotes`, () => {
    expect(rows(`молоко`, { t: RU })[0][0]).toBe(`Новая заметка: «${shown(`молоко`)}»`)
  })

  it(`create at once on Ctrl Enter, and open the form on Enter`, () => {
    const choice: SearchChoice = { kind: `quick-create`, entity: `tag`, title: `milk` }
    expect(pickedChoice(choice, false)).toEqual(choice)
    expect(pickedChoice(choice, true)).toEqual({ ...choice, now: true })
  })
})

describe(`the theme rows`, () => {
  it(`offer Theme → Dark for dark, dark mode and тёмная, mark the current one, and stay open`, () => {
    let theme: ThemePreference = `system`
    const set: ThemePreference[] = []
    const rows = themeRows(EN, () => theme, `Settings`, (next) => void set.push(next))
    expect(matchCommands(rows, `dark`)[0]?.label).toBe(`Theme → Dark`)
    expect(matchCommands(rows, `dark mode`)[0]?.label).toBe(`Theme → Dark`)
    const ru = themeRows(RU, () => theme, `Настройки`, () => {})
    expect(matchCommands(ru, `тёмная`)[0]?.label).toBe(`Тема → Тёмная`)

    const dark = rows.find((row) => row.label === `Theme → Dark`)!
    expect([dark.state, dark.keepOpen, dark.group]).toEqual([undefined, true, `Settings`])
    dark.run!({ alternative: false })
    theme = `dark`
    expect(set).toEqual([`dark`])
    expect(dark.state).toBe(`Current`)
  })
})

describe(`withRun`, () => {
  it(`runs a row's choice with the modifier, and keeps the row's live getters`, () => {
    let theme = `System`
    const row = {
      id: `a`,
      label: `Theme`,
      choice: `x`,
      get state() {
        return theme
      },
    }
    const picked: [string, boolean][] = []
    const runnable = withRun<string, CommandPaletteOption & { choice: string }>(
      row,
      (choice, details) => void picked.push([choice, details.alternative]),
    )
    runnable.run!({ alternative: true })
    theme = `Dark`
    expect(picked).toEqual([[`x`, true]])
    expect(runnable.state).toBe(`Dark`)
    expect(row).not.toHaveProperty(`run`)
  })

  it(`leaves a row without a choice, and a submenu, as they are`, () => {
    const plain = { id: `a`, label: `A` }
    const submenu = { id: `b`, label: `B`, choice: `b`, children: [] }
    expect(withRun(plain, () => {})).toBe(plain)
    expect(withRun(submenu, () => {})).toBe(submenu)
  })
})
