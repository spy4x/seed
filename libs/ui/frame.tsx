import type { ComponentChildren, JSX } from "preact"
import { useRef } from "preact/hooks"
import { canViewActivity } from "@domain/groups"
import {
  IconChartPie,
  IconClock,
  IconDocumentText,
  IconSearch,
  IconSprout,
  IconUsers,
} from "@spy4x/preact-icons"
import {
  AppShell,
  type AppShellConnection,
  type AppShellItem,
} from "@spy4x/preact-system/app-shell"
import { RailEntry, type RailItem } from "@spy4x/preact-system/rail"
import { BrandMark } from "@spy4x/preact-ui/brand-mark"
import { Button } from "@spy4x/preact-ui/button"
import { Link } from "@spy4x/preact-ui/link"
import { GroupPicker, type GroupPickerData, GroupSheet } from "./group-picker.tsx"
import {
  GROUP_PATHS,
  type Navigate,
  NOTE_PATHS,
  OVERVIEW_PATHS,
  SCREEN_PATHS,
  ScreenForm,
  TAG_PATHS,
} from "./progressive.tsx"
import { openSearch, searchHotkeys } from "./search-palette.tsx"
import { SHORTCUT_TEXT, ShortcutsList, type ShortcutsProps } from "./shortcuts.tsx"

/**
 * The daily destinations, in the order the rail and the phone tab bar show them. Four at most, so
 * the phone bar keeps its last slot for the Account sheet. Activity belongs to the selected group and
 * shows only while there is one whose log the person may read. Profile and Tags are in the account
 * menu; Tags is in Notes' "More actions" too.
 */
export function navItems(activityGroupId: string | null): AppShellItem[] {
  return [
    { key: "overview", label: "Overview", href: OVERVIEW_PATHS.root, Icon: IconChartPie },
    { key: "notes", label: "Notes", href: NOTE_PATHS.list, Icon: IconDocumentText },
    ...(activityGroupId === null ? [] : [{
      key: "activity",
      label: "Activity",
      href: GROUP_PATHS.activity(activityGroupId),
      Icon: IconClock,
    }]),
    { key: "groups", label: "Groups", href: SCREEN_PATHS.groups, Icon: IconUsers },
  ]
}

/** Where the live connection to the API stands; the shell shows it while it is not live. */
export type ConnectionStatus = AppShellConnection

/** Who is signed in, as the account menu shows it. */
export interface FrameUser {
  firstName: string
  lastName: string
  /** The address the account signs in with; left out or `null` while unknown or for a username. */
  email?: string | null
  /** Their profile picture's address (#228), shown in the account entry; left out for initials. */
  avatarUrl?: string
}

/** A theme the person can choose; `"system"` follows the device. */
export type ThemeChoice = "system" | "light" | "dark"

/**
 * The slice of the app's theme store the account menu reads and writes, described by shape so this
 * package imports no store: `createThemeStore()` from `@spy4x/preact-signals/theme` satisfies it.
 */
export interface FrameTheme {
  readonly preference: { readonly value: ThemeChoice }
  set(preference: ThemeChoice): void
}

/** The user's full name, else the e-mail address, else "User": how the account entry names them. */
export function displayName(user: FrameUser): string {
  return `${user.firstName} ${user.lastName}`.trim() || user.email || "User"
}

/**
 * The search's entry, drawn by the library as the rail's other cells and the sheet's other rows. It
 * names the palette's keys, so the rail's tooltip reads "Search (Ctrl K)" and a screen reader hears
 * them; the palette binds them itself. `/` is named only while the single keys are on.
 */
function searchEntry(slashKey: boolean): RailItem {
  return { key: "search", label: "Search", Icon: IconSearch, keyshortcuts: searchHotkeys(slashKey) }
}

/** An app's keyboard shortcuts, as the frame draws them; see {@link ShortcutsList}. */
export interface FrameShortcuts extends ShortcutsProps {
  /**
   * Whether the account menu lists "Keyboard shortcuts". The app passes whether the device has a
   * fine pointer (`(any-pointer: fine)`): a phone without a keyboard has no use for the list.
   */
  inMenu: boolean
}

/** The account menu's "Keyboard shortcuts" entry, when the frame has shortcuts to list. */
export function shortcutsMenuItems(shortcuts: FrameShortcuts | undefined) {
  return shortcuts?.inMenu
    ? [{
      label: SHORTCUT_TEXT.menuEntry,
      onClick: shortcuts.onOpen,
      dataE2E: "account-shortcuts",
      // Shown, and announced as `aria-keyshortcuts`, only while `?` works.
      keyshortcuts: shortcuts.singleKeys ? ["?"] : undefined,
    }]
    : []
}

/**
 * The signed-in frame: the library's `AppShell`, which draws every piece of chrome the same way in
 * every app, fed with this product's data.
 *
 * - The top of the 72 px rail is the group switcher ({@link GroupPicker}), then "Search", an icon
 *   cell with its tooltip that opens `search`.
 * - The middle is the destinations ({@link navItems}).
 * - The bottom is the connection while it is not live, Notifications with its unread count, and the
 *   account menu: the person's name and portrait, which open the profile, then Keyboard shortcuts
 *   on a device with a fine pointer, then Sign out. The theme is chosen on the profile only.
 *
 * On a phone the tab bar's last slot is "Account": the avatar with the unread count, opening a sheet
 * with "Search", the groups ({@link GroupSheet}), Notifications and the account's choices.
 * Choosing "Search" there closes the sheet, which gives focus back to "Account", and then opens
 * the palette; closing the palette gives focus back to "Account" again.
 *
 * `shortcuts` draws the "Keyboard shortcuts" dialog; the app binds the keys ({@link ShortcutsList}).
 *
 * `search` is drawn once, at the end of the page's column, with no trigger of its own (such as
 * `SearchPalette`, which binds Ctrl K and `/` itself). Both "Search" entries open it by clicking
 * its hidden trigger.
 *
 * Every page sits in one centred column of 48 rem; `wide` gives a data table 64 rem, and a form
 * never needs it. `banner` shows at the top of that column, above the page's own header, such as
 * the request to verify the e-mail address. Screens set no width of their own. Signed-out screens
 * use {@link PublicFrame} instead.
 *
 * The navigation entries are real links; with `navigate`, a plain click on one goes through the
 * app's router instead of loading the page, and a Ctrl- or middle-click still opens a new tab.
 */
export function AppFrame(
  {
    user,
    connection,
    currentPath,
    navigate,
    onSignOut,
    groupPicker,
    banner,
    unreadCount,
    search,
    shortcuts,
    wide = false,
    children,
  }: {
    user: FrameUser
    connection?: ConnectionStatus
    /** The address of the page shown: its entry is marked, and a page inside a section marks it. */
    currentPath?: string
    navigate?: Navigate
    onSignOut: () => void
    groupPicker?: GroupPickerData
    banner?: ComponentChildren
    /** How many notifications are unread. Left out, the rail has no bell. */
    unreadCount?: number
    /** The search palette, drawn once. Left out, the frame has no search. */
    search?: ComponentChildren
    /** The app's keyboard shortcuts and their dialog. Left out, the frame binds none. */
    shortcuts?: FrameShortcuts
    /** Gives the page the wider column (64 rem), for a data table that needs it. */
    wide?: boolean
    children: ComponentChildren
  },
): JSX.Element {
  const selected = groupPicker?.groups.find((group) => group.id === groupPicker.selectedId)
  const activityGroupId = selected && canViewActivity(selected.role) ? selected.id : null
  const name = displayName(user)
  // A person known only by the address would read it twice.
  const email = user.email && user.email !== name ? user.email : undefined
  const hasSearch = search !== undefined
  const searchItem = searchEntry(shortcuts?.singleKeys ?? true)
  const searchRoot = useRef<HTMLDivElement>(null)
  const sheetSearch = useRef<HTMLDivElement>(null)
  const open = () => openSearch(searchRoot.current)
  const openFromSheet = () => {
    const sheet = sheetSearch.current?.closest("dialog")
    if (!sheet?.open) return open()
    // The entry closes the sheet after this; the palette opens once it has, so the sheet's own
    // close handler, which focuses "Account", runs first and the palette's field keeps focus.
    sheet.addEventListener("close", open, { once: true })
  }
  return (
    <AppShell
      items={navItems(activityGroupId)}
      currentPath={currentPath}
      navigate={navigate}
      switcher={groupPicker || hasSearch
        ? ((place) =>
          place === "sheet"
            ? (
              <div class="flex flex-col gap-2">
                {hasSearch && (
                  <div ref={sheetSearch} data-e2e="shell-search-sheet">
                    <RailEntry item={searchItem} place="sheet" navigate={openFromSheet} />
                  </div>
                )}
                {groupPicker && <GroupSheet {...groupPicker} navigate={navigate} />}
              </div>
            )
            : (
              <div class="flex flex-col items-center gap-1">
                {groupPicker && <GroupPicker {...groupPicker} navigate={navigate} />}
                {hasSearch && (
                  <div data-e2e="shell-search-rail">
                    <RailEntry item={searchItem} place="rail" navigate={open} />
                  </div>
                )}
              </div>
            ))
        : undefined}
      notifications={unreadCount === undefined
        ? undefined
        : { href: SCREEN_PATHS.notifications, unread: unreadCount }}
      account={{
        user: { name, email, avatarUrl: user.avatarUrl },
        headerHref: SCREEN_PATHS.profile,
        items: [{ label: "Tags", href: TAG_PATHS.list }, ...shortcutsMenuItems(shortcuts)],
        signOut: { label: "Sign out", onClick: onSignOut },
      }}
      connection={connection}
      banner={banner}
      width={wide ? "wide" : "default"}
    >
      {children}
      {hasSearch && <div ref={searchRoot}>{search}</div>}
      {shortcuts && <ShortcutsList {...shortcuts} />}
    </AppShell>
  )
}

/**
 * The product's mark and name above the signed-out pages. It leads to `/`, which the sign-in gate
 * answers.
 */
function Brand({ navigate }: { navigate?: Navigate }): JSX.Element {
  return (
    <Link
      href={SCREEN_PATHS.home}
      navigate={navigate}
      class="flex shrink-0 items-center gap-2 rounded-md"
    >
      {/* Seed's own site: see docs/start-a-product.md */}
      <BrandMark Icon={IconSprout} name="Seed" />
    </Link>
  )
}

/** "Sign out" as a form whose submit the app takes through `onSignOut`. */
function SignOutForm({ onSignOut }: { onSignOut: () => void }): JSX.Element {
  return (
    <ScreenForm onSubmit={onSignOut}>
      <Button type="submit" variant="ghost" data-e2e="signout">
        Sign out
      </Button>
    </ScreenForm>
  )
}

/**
 * The frame for sign-in, sign-up, the second factor and the other signed-out pages: the brand above
 * a narrow, centred column, aligned with it. A user who passed the password step but not the second
 * factor also gets Sign out.
 */
export function PublicFrame(
  { canSignOut, onSignOut, navigate, children }: {
    canSignOut: boolean
    onSignOut: () => void
    navigate?: Navigate
    children: ComponentChildren
  },
): JSX.Element {
  return (
    <div class="flex min-h-dvh flex-col">
      <header class="mx-auto flex w-full max-w-md items-center justify-between gap-4 px-4 pt-8 pb-6 sm:pt-16">
        <Brand navigate={navigate} />
        {canSignOut && <SignOutForm onSignOut={onSignOut} />}
      </header>
      <main class="mx-auto w-full max-w-md px-4 pb-12">{children}</main>
    </div>
  )
}
