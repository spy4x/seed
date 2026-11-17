import type { JSX } from "preact"
import { createPortal } from "preact/compat"
import { useEffect, useRef, useState } from "preact/hooks"
import { useFormat } from "@spy4x/preact-ui/format"
import {
  CommandPalette,
  type CommandPaletteLabels,
  type CommandPaletteRecent,
  type CommandPaletteSelectDetails,
} from "@spy4x/preact-ui/command-palette"
import { hotkeyClickBinding, useHotkeys } from "@spy4x/preact-ui/hotkeys"
import type { Translator } from "@spy4x/platform/universal/i18n"
import { searchEntries } from "@spy4x/platform/universal/text"
import { type GroupRole } from "@domain/groups"
import type { ThemePreference } from "@domain/identity"
import { roleName } from "./groups-screen.tsx"
import type { ShortcutRow } from "./shortcuts.tsx"
import {
  groupRow,
  matchCommands,
  type PageCommand,
  paletteCommands,
  type PaletteContext,
  type PaletteOption,
  pickedChoice,
  quickCreateRows,
  quoted,
  type SearchChoice,
  themeRows,
  withRun,
} from "./palette-commands.ts"
import { useAppText } from "./i18n.ts"

export type { PageCommand, SearchChoice } from "./palette-commands.ts"

/** One note a search found, as the palette lists it. */
export interface SearchNote {
  id: string
  groupId: string
  title: string
  /** Plain text around the match, with "…" where it was cut; empty for an empty body. */
  snippet: string
}

/** What a note search answered, and where from. */
export interface SearchNotesAnswer {
  notes: readonly SearchNote[]
  /** `true` when the notes come from this device's copy, because the server could not be asked. */
  onDevice: boolean
}

/** One of the person's groups, matched by its name as they type. */
export interface SearchGroup {
  id: string
  name: string
  role: GroupRole
}

/** Props of {@link SearchPalette}. */
export interface SearchPaletteProps {
  /**
   * The notes for a query of at least {@link NOTE_QUERY_MIN} characters, best first; for the empty
   * query, the current group's most recent ones. `signal` aborts when the answer is no longer
   * wanted. A rejection for a typed query shows a dimmed error row under Notes, announced to a
   * screen reader, and the rest of the list stays; for the empty query nothing shows: the recent
   * notes are left out and the commands list as usual.
   */
  searchNotes: (query: string, signal: AbortSignal) => Promise<SearchNotesAnswer>
  /** Every group the person belongs to now. */
  groups: readonly SearchGroup[]
  /** The group the notes pages show, and whether the person may add notes and tags to it. */
  currentGroup: { id: string; name: string; canWrite: boolean } | null
  /** Whether the server can be reached: "New group" needs it. */
  online: boolean
  /** The open page's own commands, listed first among the commands. */
  pageCommands?: readonly PageCommand[]
  /**
   * Called with what the person picked: after the palette has closed, or with it still open for a
   * theme picked in the Theme submenu.
   */
  onSelect: (choice: SearchChoice) => void
  /** The theme chosen now, shown on the Theme command. Defaults to `"system"`. */
  theme?: ThemePreference
  /** The app's keyboard shortcuts: a command shows the keys of its row. */
  shortcuts?: readonly ShortcutRow[]
  /** The group whose Activity the rail shows, or `null` (the default) while it shows none. */
  activityGroupId?: string | null
  /** Whether the browser offers to install the app now: "Install app" is listed only then. */
  canInstall?: boolean
  /**
   * Whether `/` opens the palette too. Defaults to `true`; `false` while the person turned the
   * single-key shortcuts off on this device. Ctrl K (⌘K) always does.
   */
  slashKey?: boolean
  /**
   * The person is a guest: "Keep your account" leads the actions, found by the words a
   * person would try ("sign up", "register", "save").
   */
  guest?: boolean
  /** Whether "Open benchmark" is listed: development builds and the public demo only. */
  benchmark?: boolean
  /** Whether two-factor sign-in is on: "Turn off two-factor sign-in" is listed only then. */
  twoFactor?: boolean
  /**
   * Whether the notes example is on; left out, it is. Off, `searchNotes` is never called and no
   * row or command names notes or tags.
   */
  notes?: boolean
  /** Whether files are on; left out, they are. Off, no command uploads a file or exports data. */
  files?: boolean
  /**
   * The product's own records the palette finds, such as accounts or invoices: each source is its
   * own section after the groups and commands. Matched on the device only, never for the empty
   * query.
   */
  records?: readonly PaletteRecordSource[]
  /**
   * Where the palette keeps the person's last picks, listed under "Recent" before anything is
   * typed. Left out, nothing is remembered. The app clears it on sign-out.
   */
  recent?: CommandPaletteRecent
}

/**
 * What the palette's registry ({@link paletteCommands}) reads, from the palette's props. The app
 * builds the same list for the shortcuts dialog with it, so the two never disagree.
 *
 * @param t The app's translator.
 * @param locale The region format's locale, for sizes in a detail.
 * @param props The palette's props.
 * @param live The latest props, read when a row is drawn (the theme); defaults to `props`.
 */
export function paletteContext(
  t: Translator<string>,
  locale: string,
  props: Omit<SearchPaletteProps, "searchNotes" | "onSelect">,
  live: () => Pick<SearchPaletteProps, "theme"> = () => props,
): PaletteContext {
  return {
    t,
    locale,
    currentGroup: props.currentGroup,
    online: props.online,
    theme: () => live().theme ?? `system`,
    shortcuts: props.shortcuts ?? [],
    activityGroupId: props.activityGroupId ?? null,
    pageCommands: props.pageCommands ?? [],
    guest: props.guest ?? false,
    benchmark: props.benchmark ?? false,
    canInstall: props.canInstall ?? false,
    twoFactor: props.twoFactor ?? false,
    notes: props.notes ?? true,
    files: props.files ?? true,
  }
}

/** One record a product holds on the device, as the palette lists and matches it. */
export interface PaletteRecord {
  /** Unique within its source. */
  id: string
  /** What the palette lists and matches, in the person's language. */
  label: string
  /** The row's second line, such as an amount or a date. It is shown, not matched. */
  detail?: string
  /** Other words that find it, such as a number or an old name. */
  aliases?: readonly string[]
  /** The page a pick opens, as a page command does. */
  href: string
}

/**
 * One kind of record the palette finds, under its own heading. `records` is called on every
 * query, so it must answer from memory; return the same record objects while they are unchanged,
 * since the matcher prepares each object once and reuses that work for it.
 */
export interface PaletteRecordSource {
  /** The section's heading, in the person's language. */
  heading: string
  /** The records the device holds now. */
  records: () => readonly PaletteRecord[]
  /** The most rows the section lists, best first. Defaults to {@link RECORD_LIMIT}. */
  limit?: number
}

/** How many rows a record source lists when it sets no `limit`. */
export const RECORD_LIMIT = 5

/**
 * The keys that open the search from every page: Ctrl K (⌘K on a Mac), and `/` outside a text
 * field.
 */
export const SEARCH_HOTKEYS: readonly string[] = ["mod+k", "/"]

/** The keys that open the search now: `/` only while the single-key shortcuts are on. */
export function searchHotkeys(slashKey: boolean): readonly string[] {
  return slashKey ? SEARCH_HOTKEYS : SEARCH_HOTKEYS.filter((keys) => keys !== "/")
}

/** The fewest characters a note search takes; one letter finds too much. The API holds the same. */
export const NOTE_QUERY_MIN = 2

/** How many of the current group's notes the palette lists before anything is typed. */
export const RECENT_NOTES = 5

/** How many of This page's and of Create's commands the palette lists before anything is typed. */
export const EMPTY_COMMANDS = 3

/** How many commands a typed query lists under "Commands", best first. */
export const TYPED_COMMANDS = 6

/**
 * Milliseconds the note search has before the rest of a typed query's answer is listed without it.
 */
export const EARLY_ANSWER_MS = 150

/** How many recent picks `CommandPalette` pins under "Recent" (its own `RECENT_SHOWN`). */
const RECENT_SHOWN = 5

/** The palette's fixed words, the admin's too. */
export function paletteLabels(
  t: Translator<string>,
): Pick<CommandPaletteLabels, "search" | "placeholder" | "close" | "loading" | "error"> {
  return {
    search: t.t(`Search.search`),
    placeholder: t.t(`Search.placeholder`),
    close: t.t(`Search.close`),
    loading: t.t(`Search.loading`),
    error: t.t(`Search.error`),
  }
}

/**
 * The ids of the recent picks `recent` keeps, newest first, as `CommandPalette` stores them: none
 * when it is left out, its storage refuses the read, or it holds anything but a JSON array. Entries
 * that are not strings are skipped. Never throws.
 */
export function storedRecent(recent: CommandPaletteRecent | undefined): string[] {
  if (recent === undefined) return []
  try {
    const parsed: unknown = JSON.parse(recent.storage().getItem(recent.storageKey) ?? `[]`)
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === `string`) : []
  } catch (_error) {
    return []
  }
}

/**
 * The rows the empty query adds so "Recent" can show them: of `candidates`, those among the first
 * {@link RECENT_SHOWN} recent picks that `listed` does not hold already. `CommandPalette` pins a
 * recent pick only when the answer lists it, and takes it out of its own heading, so a recent Go to
 * or Settings pick shows under Recent alone. An id no row has any more is skipped.
 *
 * @param ids The recent picks, newest first.
 * @param listed The rows the empty query lists anyway.
 * @param candidates Every other row a recent pick may name.
 */
export function recentExtras<T extends { id: string }>(
  ids: readonly string[],
  listed: readonly T[],
  candidates: readonly T[],
): T[] {
  // A listed row wins over a candidate with its id: that is the one the palette pins.
  const byId = new Map([...candidates, ...listed].map((option) => [option.id, option]))
  const pinned = ids.flatMap((id) => byId.get(id) ?? []).slice(0, RECENT_SHOWN)
  return pinned.filter((option) => !listed.includes(option))
}

/**
 * The search of the signed-in shell, opened with Ctrl K (⌘K on a Mac) or `/` from every page, at
 * every width. It draws no trigger of its own: the frame's "Search" entries, in the rail and in the
 * phone's Account sheet, open it by clicking its hidden one ({@link openSearch}). So the hotkeys
 * still work while that trigger is hidden, the palette binds them itself, with its root, which is
 * always drawn, as what has to be on screen (`clickByHotkey`'s `shown`). One palette, so one
 * binding and one dialog at every width.
 *
 * Before anything is typed it lists, under "Recent", the last picks `recent` keeps (pinned by
 * `CommandPalette`, at most five, Go to and Settings commands too), then the first
 * {@link EMPTY_COMMANDS} of This page, the current group's {@link RECENT_NOTES} most recent notes,
 * and the first {@link EMPTY_COMMANDS} of Create.
 *
 * A query lists, first and under "Best match", the first command whose name or alias starts with
 * it, such as "Delete this note" for "delete this" (pinned by `CommandPalette`). Then the notes
 * that match (from `searchNotes`), the person's groups, at most {@link TYPED_COMMANDS} commands of
 * {@link paletteCommands} and the theme rows ({@link themeRows}) under one "Commands" heading, each
 * naming its section in its detail, each of the product's `records` sources under its own heading,
 * and last Create: its commands that match, then the quick-create rows ({@link quickCreateRows}),
 * where Enter opens the create form with the text filled in and Ctrl Enter (⌘Enter) creates the
 * item and opens it. Each section is ranked by the palette's matcher (`matchOptions`: aliases, word
 * order, one typo, the other keyboard layout and alphabet). A note search that takes longer than
 * {@link EARLY_ANSWER_MS} lists everything but the notes first; the notes then join above it
 * without moving the highlighted row. A query that starts with ">" lists only the commands: every one under its
 * section for ">" alone, else those that match the rest.
 *
 * When the notes come from the device, their heading says so, and when none of them matched, a
 * dimmed row says that only this device was searched; a query too short to search notes gets a
 * dimmed row that says so too ({@link notesHint}). Enter on a group makes it the current one, and
 * Ctrl Enter (⌘Enter) opens its settings. Theme opens a submenu whose rows change the theme at
 * once and keep the palette open.
 */
export function SearchPalette(props: SearchPaletteProps): JSX.Element {
  const root = useRef<HTMLDivElement>(null)
  useHotkeys(
    searchHotkeys(props.slashKey ?? true).map((keys) =>
      hotkeyClickBinding(keys, () => trigger(root.current), () => root.current)
    ),
  )
  const t = useAppText()
  // The search runs inside the palette, after a render; it reads the latest props through this.
  const latest = useRef(props)
  latest.current = props
  const words = useRef(t)
  words.current = t
  // Sizes in an action's detail follow the person's region format, as their dates do.
  const region = useRef(``)
  region.current = useFormat().locale
  // The recent picks as storage held them when the palette opened, which is when `CommandPalette`
  // reads them for its Recent heading too.
  const recentIds = useRef<string[]>([])
  // The palette's own status line says nothing for a failed note search, since the rest of the
  // list is still answered, so this line says it. It sits inside the palette's dialog: the page
  // outside an open modal dialog is inert, and a screen reader would not hear a change there.
  const [notesError, setNotesError] = useState(``)
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null)
  useEffect(() => setDialog(root.current?.querySelector(`dialog`) ?? null), [])

  /** A command's pick, after the palette has closed or with it open for a kept-open row. */
  const pick = (choice: SearchChoice, details: CommandPaletteSelectDetails) =>
    latest.current.onSelect(pickedChoice(choice, details.alternative))
  const runnable = (option: PaletteOption) => withRun(option, pick)

  const search = async (
    query: string,
    signal: AbortSignal,
    show: (options: readonly PaletteOption[]) => void,
  ): Promise<PaletteOption[]> => {
    const { groups, currentGroup } = latest.current
    const t = words.current
    const text = query.trim()
    const registry = context(t)
    const heading = {
      page: t.t(`Shortcuts.page`),
      create: t.t(`Search.create`),
      settings: t.t(`Search.settings`),
    }
    const commands = paletteCommands(registry, select).map(runnable)
    const themes = themeRows(
      t,
      registry.theme,
      heading.settings,
      (theme) => select({ kind: "theme", theme }),
    )
    const create = commands.filter((option) => option.group === heading.create)
    const others = [...commands.filter((option) => option.group !== heading.create), ...themes]
    const groupRows = groups.map((group) =>
      runnable(groupRow(t, group, roleName(t, group.role), group.id === currentGroup?.id))
    )
    /** The commands `needle` matches, best first, at most {@link TYPED_COMMANDS}, then Create's. */
    const matched = (needle: string) => [
      ...underCommands(t, matchCommands(others, needle, TYPED_COMMANDS)),
      ...matchCommands(create, needle, create.length),
    ]

    if (text.startsWith(`>`)) {
      const rest = text.slice(1).trim()
      return rest === `` ? commands : matched(rest)
    }

    const notesOn = latest.current.notes ?? true
    const asksNotes = notesOn && (text === "" || Array.from(text).length >= NOTE_QUERY_MIN)
    // A failed note search shows under Notes and keeps the rest of the list. A stale answer,
    // failed or not, the palette drops.
    let failed = false
    const notesFound = async (): Promise<SearchNotesAnswer> => {
      if (!asksNotes) return { notes: [], onDevice: false }
      const answer = await latest.current.searchNotes(text, signal).catch(() => {
        failed = true
        return { notes: [], onDevice: false }
      })
      // Said only when the error row is listed: for the empty query it is not.
      if (!signal.aborted) setNotesError(failed && text !== `` ? t.t(`Search.error`) : ``)
      return answer
    }
    /** The note rows of `answer`; only a query's rows name their group, when there are several. */
    const noteRows = (answer: SearchNotesAnswer) => {
      const namesGroup = text !== "" && groups.length > 1
      const groupName = new Map(groups.map((group) => [group.id, group.name]))
      const notesHeading = answer.onDevice ? t.t(`Search.notesOnDevice`) : t.t(`Search.notes`)
      return answer.notes.slice(0, text === "" ? RECENT_NOTES : undefined).map((
        note,
      ): PaletteOption => ({
        id: `note-${note.id}`,
        label: note.title.trim() || t.t(`Search.untitled`),
        detail: noteDetail(note, namesGroup ? groupName.get(note.groupId) : undefined),
        group: notesHeading,
        choice: { kind: "note", noteId: note.id, groupId: note.groupId },
      }))
    }

    if (text === ``) {
      const notes = noteRows(await notesFound())
      const listed = [
        ...commands.filter((option) => option.group === heading.page).slice(0, EMPTY_COMMANDS),
        ...notes,
        ...create.slice(0, EMPTY_COMMANDS),
      ]
      return [...listed, ...recentExtras(recentIds.current, listed, [...others, ...groupRows])]
    }

    // Everything but the notes answers from memory, so it can be listed before the notes.
    const rest = [
      ...matchCommands(groupRows, text, groupRows.length),
      ...underCommands(t, matchCommands(others, text, TYPED_COMMANDS)),
      ...recordRows(latest.current.records ?? [], text),
      ...matchCommands(create, text, create.length),
      // Built from the query, so they list for any text; under Create, after its commands.
      ...quickCreateRows(registry, text),
    ]
    // Notes that answer quickly (from the device) list with the rest, so the highlight starts on
    // the first note. A slower search lists the rest first, and its notes keep the highlight there.
    const early = asksNotes ? setTimeout(() => show(rest), EARLY_ANSWER_MS) : undefined
    const answer = await notesFound()
    clearTimeout(early)
    const notes = noteRows(answer)
    const hint = notesHint(
      t,
      text,
      notesOn,
      asksNotes && answer.onDevice && notes.length === 0,
      failed,
    )
    return [...notes, ...rest, ...hint]
  }
  /** A pick made inside a submenu, with the palette still open. */
  const select = (choice: SearchChoice) => latest.current.onSelect(choice)
  /** What the registry reads, from the latest props. */
  const context = (t: Translator<string>) =>
    paletteContext(t, region.current, latest.current, () => latest.current)
  return (
    <div ref={root} data-e2e="search-root">
      <CommandPalette<PaletteOption>
        search={search}
        // Notes and records: every command runs itself.
        onSelect={(option, details) =>
          option.choice && props.onSelect(pickedChoice(option.choice, details.alternative))}
        onOpenChange={(open) => {
          if (open) recentIds.current = storedRecent(latest.current.recent)
        }}
        recent={props.recent}
        // Bound above, so they work while the trigger is hidden.
        hotkeys={[]}
        labels={paletteLabels(t)}
        dataE2E="search"
        class="hidden"
      />
      {dialog && createPortal(
        <p role="status" data-e2e="search-notes-status" class="sr-only">{notesError}</p>,
        dialog,
      )}
    </div>
  )
}

/**
 * `options` under one "Commands" heading, each naming the section it belongs to in its detail,
 * before its own: "Settings · How the app looks on this device." Getters are kept.
 */
function underCommands(t: Translator<string>, options: readonly PaletteOption[]): PaletteOption[] {
  const heading = t.t(`Search.commands`)
  return options.map((option) => {
    const copy = Object.defineProperties({}, Object.getOwnPropertyDescriptors(option))
    return Object.assign(copy as PaletteOption, {
      detail: [option.group, option.detail].filter(Boolean).join(` · `),
      group: heading,
    })
  })
}

/** The palette's own trigger inside its root: hidden, and clicked to open it. */
function trigger(root: Element | null): HTMLButtonElement | null {
  return root?.querySelector<HTMLButtonElement>("button[aria-haspopup=dialog]") ?? null
}

/**
 * Open the palette drawn inside `container`, as the frame's "Search" entries do. Nothing happens
 * when there is none.
 */
export function openSearch(container: Element | null): void {
  trigger(container?.querySelector("[data-e2e=search-root]") ?? null)?.click()
}

/**
 * The rows of each record source that `query` matches, best first, at most its limit, under its
 * heading. A query the matcher reads as empty (nothing typed, or only punctuation) matches every
 * record with score `0`, so those are dropped: any real match scores more.
 */
function recordRows(sources: readonly PaletteRecordSource[], query: string): PaletteOption[] {
  return sources.flatMap((source, index) =>
    searchEntries(query, source.records(), { limit: source.limit ?? RECORD_LIMIT })
      .filter((match) => match.score > 0)
      .map(({ entry }): PaletteOption => ({
        id: `record-${index}-${entry.id}`,
        label: entry.label,
        detail: entry.detail,
        group: source.heading,
        choice: { kind: "page", href: entry.href },
      }))
  )
}

/**
 * A dimmed row under the notes heading that says why no note is listed: the query is too short to
 * search notes, the search `failed`, or `noneOnDevice`, only this device's notes were searched and
 * none matched, so the person searches again online before creating a duplicate. None for the
 * empty query or with the notes off. It is disabled and listed last, so a runnable row such as
 * `New note: "…"` keeps the highlight and Enter never picks it.
 */
function notesHint(
  t: Translator<string>,
  text: string,
  notesOn: boolean,
  noneOnDevice: boolean,
  failed: boolean,
): PaletteOption[] {
  if (text === "" || !notesOn) return []
  // An empty reason disables the row; its label already says why.
  const hint = (
    label: string,
    heading: string,
  ): PaletteOption[] => [{ id: `notes-hint`, label, group: t.t(heading), disabledReason: `` }]
  if (Array.from(text).length < NOTE_QUERY_MIN) {
    return hint(t.t(`Search.tooShort`, { count: NOTE_QUERY_MIN }), `Search.notes`)
  }
  if (failed) return hint(t.t(`Search.error`), `Search.notes`)
  return noneOnDevice
    ? hint(t.t(`Search.emptyOnDevice`, { query: quoted(text) }), `Search.notesOnDevice`)
    : []
}

/** A note row's second line: the group, when the person has several, then the snippet. */
function noteDetail(note: SearchNote, groupName: string | undefined): string | undefined {
  const parts = [groupName, note.snippet].filter((part) => part !== undefined && part !== "")
  return parts.length > 0 ? parts.join(" · ") : undefined
}
