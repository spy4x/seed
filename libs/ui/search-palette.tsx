import type { JSX } from "preact"
import { useRef, useState } from "preact/hooks"
import { useFormat } from "@spy4x/preact-ui/format"
import {
  CommandPalette,
  type CommandPaletteLabels,
  matchOptions,
} from "@spy4x/preact-ui/command-palette"
import { hotkeyClickBinding, useHotkeys } from "@spy4x/preact-ui/hotkeys"
import type { Translator } from "@spy4x/platform/universal/i18n"
import { type GroupRole } from "@domain/groups"
import type { ThemePreference } from "@domain/identity"
import { roleName } from "./groups-screen.tsx"
import type { ShortcutRow } from "./shortcuts.tsx"
import {
  groupRow,
  type PageCommand,
  paletteCommands,
  type PaletteOption,
  pickedChoice,
  type SearchChoice,
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
   * wanted. A rejection shows the error line.
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
  /**
   * Whether the notes example is on; left out, it is. Off, `searchNotes` is never called and no
   * row or command names notes or tags.
   */
  notes?: boolean
}

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

/** The most characters of the query the no-results line repeats. */
const QUOTED_MAX = 40

/** The palette's fixed words, the admin's too; the no-results line is set per answer. */
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

/** `query` trimmed and cut to {@link QUOTED_MAX} characters, an emoji counting as one. */
export function quoted(query: string): string {
  const characters = Array.from(query.trim())
  return characters.length > QUOTED_MAX
    ? `${characters.slice(0, QUOTED_MAX).join("")}…`
    : characters.join("")
}

/**
 * The no-results line for a query too short to search notes: groups and actions were matched, the
 * notes were not, so it must not say that no note matches.
 */
function shortQueryLabel(t: Translator<string>): string {
  return t.t(`Search.tooShort`, { count: NOTE_QUERY_MIN })
}

/** The no-results line for `query`, which says where the search looked. */
export function emptyLabel(t: Translator<string>, query: string, onDevice: boolean): string {
  return onDevice
    ? t.t(`Search.emptyOnDevice`, { query: quoted(query) })
    : t.t(`Search.empty`, { query: quoted(query) })
}

/**
 * The search of the signed-in shell, opened with Ctrl K (⌘K on a Mac) or `/` from every page, at
 * every width. It draws no trigger of its own: the frame's "Search" entries, in the rail and in the
 * phone's Account sheet, open it by clicking its hidden one ({@link openSearch}). So the hotkeys
 * still work while that trigger is hidden, the palette binds them itself, with its root, which is
 * always drawn, as what has to be on screen (`clickByHotkey`'s `shown`). One palette, so one
 * binding and one dialog at every width.
 *
 * Before anything is typed it lists the current group's most recent notes, then the commands of
 * {@link paletteCommands}. A query lists the notes that match (from `searchNotes`), then the
 * person's groups and the commands that match, ranked together as the palette ranks a submenu
 * (`matchOptions`: aliases, word order, one typo, the other keyboard layout and alphabet), so the
 * strongest match is the first row after the notes and its heading comes first.
 * When the notes come from the device, their heading and the no-results line say so. Enter on a
 * group makes it the current one, and Ctrl Enter (⌘Enter) opens its settings. Theme opens a
 * submenu whose rows change the theme at once and keep the palette open.
 */
export function SearchPalette(props: SearchPaletteProps): JSX.Element {
  const root = useRef<HTMLDivElement>(null)
  useHotkeys(
    searchHotkeys(props.slashKey ?? true).map((keys) =>
      hotkeyClickBinding(keys, () => trigger(root.current), () => root.current)
    ),
  )
  const t = useAppText()
  const [empty, setEmpty] = useState(emptyLabel(t, "", false))
  // The search runs inside the palette, after a render; it reads the latest props through this.
  const latest = useRef(props)
  latest.current = props
  const words = useRef(t)
  words.current = t
  // Sizes in an action's detail follow the person's region format, as their dates do.
  const region = useRef(``)
  region.current = useFormat().locale

  const search = async (query: string, signal: AbortSignal): Promise<PaletteOption[]> => {
    const { groups, currentGroup } = latest.current
    const t = words.current
    const text = query.trim()
    const notesOn = latest.current.notes ?? true
    const asksNotes = notesOn && (text === "" || Array.from(text).length >= NOTE_QUERY_MIN)
    const answer = asksNotes
      ? await latest.current.searchNotes(text, signal)
      : { notes: [], onDevice: false }
    // The recent notes are all the current group's, so only a query's rows name their group.
    const namesGroup = text !== "" && groups.length > 1
    const groupName = new Map(groups.map((group) => [group.id, group.name]))
    const notesHeading = answer.onDevice ? t.t(`Search.notesOnDevice`) : t.t(`Search.notes`)
    const notes = answer.notes.slice(0, text === "" ? RECENT_NOTES : undefined).map((
      note,
    ): PaletteOption => ({
      id: `note-${note.id}`,
      label: note.title.trim() || t.t(`Search.untitled`),
      detail: noteDetail(note, namesGroup ? groupName.get(note.groupId) : undefined),
      group: notesHeading,
      choice: { kind: "note", noteId: note.id, groupId: note.groupId },
    }))
    const groupRows = text === ""
      ? []
      : groups.map((group) =>
        groupRow(t, group, roleName(t, group.role), group.id === currentGroup?.id)
      )
    // Groups and commands are ranked together, so the strongest match of either is highlighted
    // first; the palette lists each heading where its first row falls.
    const rows = [...groupRows, ...paletteCommands(context(t), select)]
    const matched = matchOptions(rows, text, rows.length)
    // A stale answer is dropped by the palette; its words must not replace the current ones.
    if (!signal.aborted) {
      setEmpty(
        asksNotes || !notesOn ? emptyLabel(t, text, answer.onDevice) : shortQueryLabel(t),
      )
    }
    return [...notes, ...matched]
  }
  /** A pick made inside a submenu, with the palette still open. */
  const select = (choice: SearchChoice) => latest.current.onSelect(choice)
  /** What the registry reads, from the latest props. */
  const context = (t: Translator<string>) => {
    const props = latest.current
    return {
      t,
      locale: region.current,
      currentGroup: props.currentGroup,
      online: props.online,
      theme: () => latest.current.theme ?? `system`,
      shortcuts: props.shortcuts ?? [],
      activityGroupId: props.activityGroupId ?? null,
      pageCommands: props.pageCommands ?? [],
      guest: props.guest ?? false,
      benchmark: props.benchmark ?? false,
      canInstall: props.canInstall ?? false,
      notes: props.notes ?? true,
    }
  }

  return (
    <div ref={root} data-e2e="search-root">
      <CommandPalette<PaletteOption>
        search={search}
        onSelect={(option, details) =>
          option.choice && props.onSelect(pickedChoice(option.choice, details.alternative))}
        // Bound above, so they work while the trigger is hidden.
        hotkeys={[]}
        labels={{ ...paletteLabels(t), empty }}
        dataE2E="search"
        class="hidden"
      />
    </div>
  )
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

/** A note row's second line: the group, when the person has several, then the snippet. */
function noteDetail(note: SearchNote, groupName: string | undefined): string | undefined {
  const parts = [groupName, note.snippet].filter((part) => part !== undefined && part !== "")
  return parts.length > 0 ? parts.join(" · ") : undefined
}
