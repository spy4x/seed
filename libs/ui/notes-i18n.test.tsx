/**
 * The notes, tags, search and shortcuts screens in the `en-XA` pseudo-language (#275), in a
 * browser DOM (happy-dom). `en-XA` wraps every catalog message in `⟦ ⟧`: rendered in it, a screen
 * shows no English outside those marks except data (a note's title, a group's name, a file's name,
 * a size, and the dates in `<time>`, which `Intl` words). English left in the code, past the
 * catalog, fails here. The overview's note widgets are drawn on their own, since the overview
 * screen around them belongs to another lane of #275.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import { type Catalog, createTranslator, pseudoLocalize } from "@spy4x/platform/universal/i18n"
import { I18nContext } from "@spy4x/preact-ui/i18n"
import { FormatContext } from "@spy4x/preact-ui/format"
import { createFormatters } from "@spy4x/time/format"
import uiEn from "@spy4x/preact-ui/i18n/en"
import systemEn from "@spy4x/preact-system/i18n/en"
import chartsEn from "@spy4x/preact-charts/i18n/en"
import appEn from "@i18n/app/en.json" with { type: "json" }
import { GroupRole, overviewPeriods } from "@domain/groups"
import { NOTE_WIDGET_IDS } from "@domain/notes"
import { NOTE_WIDGET_VIEWS } from "./note-widgets.tsx"
import { NO_NOTE_FILTERS } from "./notes-filter.ts"
import { NotesScreen } from "./notes-screen.tsx"
import { NoteEditorScreen } from "./note-editor-screen.tsx"
import { TagsScreen } from "./tags-screen.tsx"
import { TagEditorScreen } from "./tag-editor-screen.tsx"
import { NewNoteDialog } from "./new-note-dialog.tsx"
import { generalRows, SHORTCUT_GROUPS, ShortcutsList } from "./shortcuts.tsx"
import { SearchPalette } from "./search-palette.tsx"

const window = new Window({ url: "http://app.localhost/" })
const own = {
  document: globalThis.document,
  location: globalThis.location,
  getComputedStyle: globalThis.getComputedStyle,
  Element: globalThis.Element,
  HTMLElement: globalThis.HTMLElement,
}

beforeAll(() => {
  Object.assign(globalThis, {
    document: window.document,
    location: window.location,
    getComputedStyle: window.getComputedStyle.bind(window),
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

/** Every catalog the SPA loads, pseudo-localized. */
const PSEUDO = createTranslator({
  language: `en-XA`,
  catalogs: ([uiEn, systemEn, chartsEn, appEn] as Catalog[]).map((source) => ({
    source,
    translation: pseudoLocalize(source),
  })),
})
const FORMAT = createFormatters({ locale: `en-GB`, timeZone: `Europe/Berlin`, hourCycle: `h23` })

async function mount(node: VNode): Promise<void> {
  root ??= document.body.appendChild(document.createElement("div"))
  await act(() =>
    render(
      <I18nContext.Provider value={PSEUDO}>
        <FormatContext.Provider value={FORMAT}>{node}</FormatContext.Provider>
      </I18nContext.Provider>,
      root!,
    )
  )
}

/** Lets the search palette's pause in typing pass, and its search and renders finish. */
async function settle(): Promise<void> {
  await act(() => new Promise((resolve) => setTimeout(resolve, 260)))
}

/** The page's words a person reads or hears: its text and its labels, dates left out. */
function readable(): string[] {
  const texts: string[] = []
  const walker = document.createTreeWalker(document.body, 4 /* NodeFilter.SHOW_TEXT */)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest(`script, style, time`)) continue
    texts.push(node.textContent ?? ``)
  }
  for (const element of document.body.querySelectorAll(`*`)) {
    if (element.closest(`time`)) continue
    for (const name of [`aria-label`, `placeholder`, `title`]) {
      const value = element.getAttribute(name)
      if (value) texts.push(value)
    }
  }
  return texts.map((text) => text.trim()).filter(Boolean)
}

/** The data these screens show as it is: titles, names, files, sizes and key names. */
const DATA = [
  // Another lane's English, until it moves to the catalog (#275): the account screens'
  // `PICTURE_RULE`, which the palette's "Change picture" action shows.
  `JPEG, PNG, WebP or HEIC, up to 10 MB`,
  // The exact time a screen reader hears after "Updated by …, 26 days ago".
  FORMAT.exact(`2026-10-01T10:00:00.000Z`),
  `Groceries`,
  `Trip`,
  `Team`,
  `Family`,
  `Work`,
  `Urgent`,
  `Home`,
  `Maya Chen`,
  `MC`,
  `scan.pdf`,
  `Weekly plan`,
  `call the bank`,
  `Acme Studio`,
  `Buy milk`,
  `Ctrl`,
  `Esc`,
  `KB`,
  `MB`,
  // The chart's days, as the person's region writes them.
  ...[`19`, `20`, `21`].map((d) => FORMAT.utc().dayMonth(`2026-10-${d}T00:00:00Z`)),
]

/**
 * The English left on the page once the pseudo-text and the data are taken out. A message split
 * around a value or a tag spans several nodes, and only the first and last carry `⟦` and `⟧`, so a
 * word counts as English only when it has a vowel `en-XA` did not accent.
 */
function english(): string[] {
  return readable().filter((text) => {
    let rest = text.replaceAll(/⟦[^⟧]*(⟧|$)/g, ``).replace(/^[^⟦]*⟧/, ``)
    for (const data of DATA) rest = rest.replaceAll(data, ``)
    return (rest.match(/[A-Za-z]{2,}/g) ?? []).some((word) => /[aeiouAEIOU]/.test(word))
  })
}

/** The page holds the pseudo-text of every message: the render reached each part checked. */
function expectReached(messages: (string | [string, Record<string, string>])[]): void {
  const page = document.body.textContent ?? ``
  for (const message of messages) {
    const [key, values] = typeof message === `string` ? [message, undefined] : message
    expect(page).toContain(PSEUDO.t(key, values))
  }
}

const team = { id: `0199c3a0-0000-7000-8000-000000000001`, name: `Team`, canWrite: true }
const urgent = { id: `0199c3a0-0000-7000-8000-000000000201`, name: `Urgent`, color: `#b91c1c` }
const home = { id: `0199c3a0-0000-7000-8000-000000000202`, name: `Home`, color: `#1d4ed8` }
const groceries = {
  id: `0199c3a0-0000-7000-8000-000000000101`,
  title: `Groceries`,
  body: `milk`,
  version: 3,
  createdAt: `2026-03-12T09:00:00.000Z`,
  updatedAt: `2026-10-01T10:00:00.000Z`,
  authorId: `0199c3a0-0000-7000-8000-000000000301`,
  authorName: `Maya Chen`,
  tagIds: [urgent.id, home.id],
}
const trip = { ...groceries, id: `0199c3a0-0000-7000-8000-000000000102`, title: `Trip` }
const targets = [
  { id: `0199c3a0-0000-7000-8000-000000000002`, name: `Family` },
  { id: `0199c3a0-0000-7000-8000-000000000003`, name: `Work` },
]
const MB = 1024 * 1024

describe(`the notes, tags, search and shortcuts screens in en-XA`, () => {
  it(`show no English outside the catalogs on the notes list`, async () => {
    await mount(
      <NotesScreen
        group={team}
        notes={[groceries, trip]}
        loading={false}
        listError={`NoteMessages.load`}
        moveTargets={targets}
        onMove={() => {}}
        onDelete={() => {}}
        onCopyLink={() => {}}
        onShowDeletedChange={() => {}}
        tags={[urgent, home]}
        filters={{ ...NO_NOTE_FILTERS, tagIds: [urgent.id] }}
        onFiltersChange={() => {}}
        onClearFilters={() => {}}
        authors={[{ id: groceries.authorId, name: `Maya Chen` }]}
        youId={groceries.authorId}
      />,
    )
    expect(english()).toEqual([])
    expectReached([`Notes.title`, `NoteMessages.load`])
  })

  it(`show no English outside the catalogs on a note, its authorship and its files`, async () => {
    await mount(
      <NoteEditorScreen
        group={team}
        loading={false}
        notFound={false}
        note={{ id: groceries.id, version: 3, conflict: true, savedTitle: groceries.title }}
        value={groceries}
        errors={{ title: null, form: null }}
        saving={false}
        deleting={false}
        onDelete={() => {}}
        moveTargets={targets}
        onMove={() => {}}
        moveError={{ key: `NoteMessages.move` }}
        tags={[urgent, home]}
        authorship={{
          createdAt: groceries.createdAt,
          createdBy: `Maya Chen`,
          updatedAt: groceries.updatedAt,
          updatedBy: `Maya Chen`,
        }}
        attachments={{
          items: [{
            id: `f1`,
            name: `scan.pdf`,
            size: MB,
            type: `application/pdf`,
            status: `ready`,
          }],
          usage: {
            files: 37,
            bytes: 41 * MB,
            maxFiles: 100,
            maxBytes: 200 * MB,
            maxFileBytes: 2 * MB,
            maxPerNote: 10,
          },
          refusals: [{ key: `AttachmentMessages.type`, values: { name: `scan.pdf` } }],
          plan: null,
          announcement: { key: `AttachmentMessages.uploaded`, values: { name: `scan.pdf` } },
          onAdd: () => {},
          onRemove: () => Promise.resolve(null),
          onDownload: () => Promise.resolve(null),
        }}
      />,
    )
    expect(english()).toEqual([])
    expectReached([
      `NoteAttachments.title`,
      `NoteMessages.move`,
      [`AttachmentMessages.type`, { name: `scan.pdf` }],
    ])
  })

  it(`show no English outside the catalogs on the tags list and a tag`, async () => {
    await mount(
      <>
        <TagsScreen
          group={team}
          tags={[urgent, home]}
          loading={false}
          listError={null}
          onDelete={() => {}}
        />
        <TagEditorScreen
          group={team}
          loading={false}
          notFound={false}
          tag={home}
          value={{ name: home.name, color: home.color }}
          errors={{ name: `TagMessages.nameTaken`, form: null }}
          saving={false}
          dirty
          onDelete={() => {}}
        />
      </>,
    )
    expect(english()).toEqual([])
    expectReached([`Tags.title`, `TagMessages.nameTaken`])
  })

  it(`show no English outside the catalogs in the New note dialog and the shortcuts`, async () => {
    await mount(
      <>
        <NewNoteDialog
          open
          onClose={() => {}}
          groups={[team, targets[0]]}
          groupId={null}
          onGroupChange={() => {}}
          // deno-lint-ignore ui-text/no-literal -- the person's own title, typed in the test
          title={`Buy milk`}
          onTitleChange={() => {}}
          pending={false}
          errors={{ group: `NewNote.chooseGroupError` }}
          added={{
            noteId: groceries.id,
            groupId: team.id,
            title: `Buy milk`,
            groupName: `Family`,
            onDevice: true,
          }}
          onAdd={() => {}}
          onOpenNote={() => {}}
        />
        <ShortcutsList
          rows={[
            ...generalRows(() => {}),
            { keys: `n`, description: `Shortcuts.newNoteRow`, group: SHORTCUT_GROUPS.newNote },
          ]}
          open
          onOpen={() => {}}
          onClose={() => {}}
          singleKeys
          onSingleKeys={() => {}}
        />
      </>,
    )
    expect(english()).toEqual([])
    expectReached([`NewNote.chooseGroupError`, `Shortcuts.inFields`])
  })

  it(`show no English outside the catalogs in the search palette`, async () => {
    await mount(
      <SearchPalette
        searchNotes={() =>
          Promise.resolve({
            notes: [{ id: `n1`, groupId: team.id, title: `Weekly plan`, snippet: `call the bank` }],
            onDevice: true,
          })}
        groups={[{ id: team.id, name: team.name, role: GroupRole.OWNER }]}
        currentGroup={team}
        online
        onSelect={() => {}}
      />,
    )
    await act(() => {
      document.querySelector(`[data-e2e=search-open]`)!.dispatchEvent(
        new window.MouseEvent(`click`, { bubbles: true }) as unknown as Event,
      )
    })
    await settle()
    expect(english()).toEqual([])
    expectReached([`Search.notesOnDevice`, `Search.actions`])
  })
  it(`draw the overview's note widgets with no English outside the catalogs`, async () => {
    const periods = overviewPeriods({ from: `2026-10-19`, to: `2026-10-21` })!
    const context = { periods, endsToday: false, format: FORMAT }
    const days = [`2026-10-19`, `2026-10-20`, `2026-10-21`]
    const data = {
      [NOTE_WIDGET_IDS.total]: { current: 31, previous: 27 },
      [NOTE_WIDGET_IDS.added]: { current: 0, previous: 11 },
      [NOTE_WIDGET_IDS.series]: { days, current: [27, 30, 31], previous: [20, 22, 27] },
    }
    await mount(
      <>
        {Object.entries(data).map(([id, result]) => {
          const drawing = NOTE_WIDGET_VIEWS[id].draw(result, context)
          return (
            <section key={id}>
              <p>{drawing.caption}</p>
              {drawing.content}
            </section>
          )
        })}
      </>,
    )
    expect(english()).toEqual([])
    expectReached([`NoteWidgets.addedNone`])
    // The card's own lines come as keys of the catalog, which the overview translates.
    const total = NOTE_WIDGET_VIEWS[NOTE_WIDGET_IDS.total]
    expect(PSEUDO.t(total.loadingKey)).toContain(`⟦`)
    expect(PSEUDO.t(total.errorKey)).toContain(`⟦`)
  })
})
