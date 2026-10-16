import type { ComponentChildren, JSX } from "preact"
import { canViewActivity } from "@domain/groups"
import {
  IconBell,
  IconClock,
  IconDocumentText,
  IconTag,
  IconUser,
  IconUsers,
} from "@spy4x/preact-icons"
import { RailShell, type RailShellItem } from "@spy4x/preact-system/rail-shell"
import { Avatar } from "@spy4x/preact-ui/avatar"
import { badgeClasses } from "@spy4x/preact-ui/badge"
import { Button } from "@spy4x/preact-ui/button"
import { Dropdown, DropdownItem } from "@spy4x/preact-ui/dropdown"
import { Page } from "@spy4x/preact-ui/layout"
import { Link } from "@spy4x/preact-ui/link"
import { GroupPicker, type GroupPickerData } from "./group-picker.tsx"
import {
  GROUP_PATHS,
  type Navigate,
  NOTE_PATHS,
  SCREEN_PATHS,
  ScreenForm,
  TAG_PATHS,
} from "./progressive.tsx"

/**
 * The daily destinations, in the order the rail and the phone tab bar show them. Five at most, so
 * the phone bar needs no "More". Activity belongs to the selected group and shows only while there
 * is one whose log the person may read.
 */
export function navItems(activityGroupId: string | null): RailShellItem[] {
  return [
    { key: "notes", label: "Notes", href: NOTE_PATHS.list, Icon: IconDocumentText },
    { key: "tags", label: "Tags", href: TAG_PATHS.list, Icon: IconTag },
    ...(activityGroupId === null ? [] : [{
      key: "activity",
      label: "Activity",
      href: GROUP_PATHS.activity(activityGroupId),
      Icon: IconClock,
    }]),
    { key: "groups", label: "Groups", href: SCREEN_PATHS.groups, Icon: IconUsers },
    { key: "profile", label: "Profile", href: SCREEN_PATHS.profile, Icon: IconUser },
  ]
}

/**
 * The navigation entry a path belongs to: a note belongs to Notes, a group's activity log to
 * Activity, any other group page to Groups, and the e-mail page to Profile, where it is opened from.
 */
export function navKey(path: string | undefined): string | undefined {
  if (path === undefined) return undefined
  if (path === NOTE_PATHS.list || path.startsWith(`${NOTE_PATHS.list}/`)) return "notes"
  if (path === TAG_PATHS.list || path.startsWith(`${TAG_PATHS.list}/`)) return "tags"
  if (/^\/groups\/[^/]+\/activity\/?$/.test(path)) return "activity"
  if (path === SCREEN_PATHS.groups || path.startsWith(`${SCREEN_PATHS.groups}/`)) return "groups"
  if (path === SCREEN_PATHS.profile || path === SCREEN_PATHS.email) return "profile"
  return undefined
}

/** Where the live connection to the API stands. */
export type ConnectionStatus = "idle" | "connecting" | "open" | "closed" | "reconnecting"

const CONNECTION_TEXT: Record<ConnectionStatus, string> = {
  idle: "Offline",
  connecting: "Connecting…",
  open: "Online",
  closed: "Offline",
  reconnecting: "Reconnecting…",
}

/**
 * Whether a person needs to see the connection. A live one, or one still opening at start-up, is
 * not news; offline and reconnecting are, because changes wait until it is back.
 */
export function connectionIsNews(status: ConnectionStatus): boolean {
  return status === "idle" || status === "closed" || status === "reconnecting"
}

/** Who is signed in, as the account menu shows it. */
export interface FrameUser {
  firstName: string
  lastName: string
  /** The address the account signs in with; left out or `null` while unknown or for a username. */
  email?: string | null
}

/** A theme the person can choose in the account menu; `"system"` follows the device. */
export type ThemeChoice = "system" | "light" | "dark"

/**
 * The slice of the app's theme store the account menu reads and writes, described by shape so this
 * package imports no store: `createThemeStore()` from `@spy4x/preact-signals/theme` satisfies it.
 */
export interface FrameTheme {
  readonly preference: { readonly value: ThemeChoice }
  set(preference: ThemeChoice): void
}

const THEME_CHOICES: readonly { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
]

/**
 * The product's mark and name. Signed in, it leads to the notes, the product's home, and on a phone
 * shows the mark alone; signed out, it leads to `/`, which the sign-in gate answers.
 */
function Brand(
  { navigate, compact }: { navigate?: Navigate; compact?: boolean },
): JSX.Element {
  return (
    <Link
      href={compact ? NOTE_PATHS.list : SCREEN_PATHS.profile}
      navigate={navigate}
      class={compact
        ? "flex min-h-11 shrink-0 items-center gap-2 rounded-md sm:min-h-9"
        : "flex shrink-0 items-center gap-2 rounded-md"}
      aria-label={compact ? "Seed" : undefined}
    >
      <span
        class="flex size-7 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground"
        aria-hidden="true"
      >
        S
      </span>
      <span
        class={compact ? "hidden text-base font-semibold sm:inline" : "text-base font-semibold"}
      >
        Seed
      </span>
    </Link>
  )
}

/** The user's full name, or "User" before they set one. */
function displayName(user: FrameUser): string {
  return `${user.firstName} ${user.lastName}`.trim() || "User"
}

/** The most the bell's badge writes; more reads "99+" so the badge keeps its size. */
const BADGE_MAX = 99

/** The bell's accessible name: `Notifications`, or `Notifications, 3 unread`. */
export function bellLabel(unreadCount: number): string {
  return unreadCount > 0 ? `Notifications, ${unreadCount} unread` : `Notifications`
}

/**
 * The inbox's bell in the header: a link to the notifications page with the unread count in a
 * badge while there is any. The count is part of the link's name, so a screen reader hears it; the
 * badge itself is hidden from it. The target is 44 px square on a phone.
 */
function NotificationBell(
  { unreadCount, navigate }: { unreadCount: number; navigate?: Navigate },
): JSX.Element {
  return (
    <Link
      href={SCREEN_PATHS.notifications}
      navigate={navigate}
      aria-label={bellLabel(unreadCount)}
      class="relative flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-foreground sm:min-h-9 sm:min-w-9"
      data-e2e="shell-bell"
    >
      <IconBell class="size-5" aria-hidden="true" />
      {unreadCount > 0 && (
        <span
          class={badgeClasses(
            "red",
            "filled",
            "absolute top-0.5 right-0.5 min-w-4 justify-center px-1 py-0 text-[10px] leading-4",
          )}
          aria-hidden="true"
          data-e2e="shell-bell-count"
        >
          {unreadCount > BADGE_MAX ? `${BADGE_MAX}+` : unreadCount}
        </span>
      )}
    </Link>
  )
}

/**
 * The connection in the header. Its text is always there for screen readers and the e2e specs;
 * a person sees it only while it is news ({@link connectionIsNews}).
 */
function ConnectionState({ status }: { status: ConnectionStatus }): JSX.Element {
  const visible = connectionIsNews(status)
  return (
    <span
      class={visible
        ? "inline-flex items-center gap-2 rounded-full bg-warning-soft px-3 py-1 text-xs font-medium text-warning"
        : "sr-only"}
      role="status"
      data-e2e="shell-ws-status"
    >
      {CONNECTION_TEXT[status]}
    </span>
  )
}

/** A hairline between the menu's parts; a separator is a menu's own child, so it needs no item. */
function MenuDivider(): JSX.Element {
  return <div role="separator" class="my-1 border-t border-subtle" />
}

/**
 * The account menu behind the avatar: who is signed in, the account's pages, the theme and Sign out.
 * The theme is a set of radio items, so the arrow keys reach it like every other entry.
 */
function AccountMenu(
  { user, theme, navigate, onSignOut }: {
    user: FrameUser
    theme?: FrameTheme
    navigate?: Navigate
    onSignOut: () => void
  },
): JSX.Element {
  const name = displayName(user)
  return (
    <Dropdown
      trigger={<Avatar name={name} alt="" size="sm" />}
      triggerLabel={`Account: ${name}`}
      triggerDataE2E="shell-user-menu-button"
      triggerClasses="flex min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-hover sm:min-h-9 sm:min-w-9"
      panelClasses="w-64"
      menuLabel="Account menu"
    >
      <div role="none" class="flex flex-col px-4 py-2" data-e2e="shell-user-identity">
        <span class="truncate font-medium text-foreground">{name}</span>
        {user.email && <span class="truncate text-sm text-muted">{user.email}</span>}
      </div>
      <MenuDivider />
      <DropdownItem href={SCREEN_PATHS.profile} navigate={navigate} dataE2E="shell-menu-profile">
        Profile
      </DropdownItem>
      <DropdownItem
        href={SCREEN_PATHS.notifications}
        navigate={navigate}
        dataE2E="shell-menu-notifications"
      >
        Notifications
      </DropdownItem>
      {theme && (
        <>
          <MenuDivider />
          <div role="group" aria-labelledby="shell-theme-label" data-e2e="shell-theme">
            <span
              id="shell-theme-label"
              role="none"
              class="block px-4 pt-1 pb-1 text-xs font-medium text-muted"
            >
              Theme
            </span>
            {THEME_CHOICES.map((choice) => (
              <DropdownItem
                key={choice.value}
                checked={theme.preference.value === choice.value}
                onClick={() => theme.set(choice.value)}
                dataE2E={`shell-theme-${choice.value}`}
              >
                {choice.label}
              </DropdownItem>
            ))}
          </div>
        </>
      )}
      <MenuDivider />
      <DropdownItem onClick={onSignOut} dataE2E="signout">Sign out</DropdownItem>
    </Dropdown>
  )
}

/**
 * The header's row: the brand and the group switcher on the left; the connection while it is not
 * live, the bell and the account menu on the right.
 */
function HeaderBar(
  { user, theme, connection, navigate, onSignOut, groupPicker, unreadCount }: {
    user: FrameUser
    theme?: FrameTheme
    connection?: ConnectionStatus
    navigate?: Navigate
    onSignOut: () => void
    groupPicker?: GroupPickerData
    unreadCount?: number
  },
): JSX.Element {
  return (
    <div class="flex h-14 items-center gap-2 border-b border-subtle bg-surface px-4 sm:gap-3 sm:px-6">
      <Brand navigate={navigate} compact />
      {groupPicker && <GroupPicker {...groupPicker} navigate={navigate} />}
      <div class="ml-auto flex shrink-0 items-center gap-1">
        {connection && <ConnectionState status={connection} />}
        {unreadCount !== undefined && (
          <NotificationBell unreadCount={unreadCount} navigate={navigate} />
        )}
        <AccountMenu user={user} theme={theme} navigate={navigate} onSignOut={onSignOut} />
      </div>
    </div>
  )
}

/**
 * Keeps `RailShell`'s `<header>` at the top of the window while the page scrolls. The shell draws
 * that element itself, so the classes reach it through its root.
 */
const STICKY_HEADER =
  "[&_[data-e2e=rail-shell-header]]:sticky [&_[data-e2e=rail-shell-header]]:top-0 [&_[data-e2e=rail-shell-header]]:z-20"

/**
 * The signed-in frame, mobile first: a bottom tab bar on a phone and a rail from `md` up
 * (`RailShell`), and a slim header with the brand, the group switcher, the connection while it is
 * not live, the inbox's bell with its unread count, and the account menu. The header is
 * `RailShell`'s `header`, so it is the page's banner, outside `<main>`, and the skip link jumps past
 * it.
 *
 * Every page sits in one centred column of 48 rem (`Page`); `wide` gives a data table 64 rem, and a
 * form never needs it. `banner` shows at the top of that column, above the page's own header, such
 * as the request to verify the e-mail address. Screens set no width of their own. Signed-out
 * screens use {@link PublicFrame} instead.
 *
 * The navigation entries are real links; with `navigate`, a plain click on one goes through the
 * app's router instead of loading the page, and a Ctrl- or middle-click still opens a new tab.
 */
export function AppFrame(
  {
    user,
    theme,
    connection,
    currentPath,
    navigate,
    onSignOut,
    groupPicker,
    banner,
    unreadCount,
    wide = false,
    children,
  }: {
    user: FrameUser
    /** The theme store; left out, the account menu offers no theme. */
    theme?: FrameTheme
    connection?: ConnectionStatus
    currentPath?: string
    navigate?: Navigate
    onSignOut: () => void
    groupPicker?: GroupPickerData
    banner?: ComponentChildren
    /** How many notifications are unread. Left out, the header has no bell. */
    unreadCount?: number
    /** Gives the page the wider column (64 rem), for a data table that needs it. */
    wide?: boolean
    children: ComponentChildren
  },
): JSX.Element {
  const selected = groupPicker?.groups.find((group) => group.id === groupPicker.selectedId)
  const activityGroupId = selected && canViewActivity(selected.role) ? selected.id : null
  return (
    <RailShell
      items={navItems(activityGroupId)}
      currentKey={navKey(currentPath)}
      navigateLink={navigate && ((_key, href) => navigate(href))}
      class={STICKY_HEADER}
      header={
        <HeaderBar
          user={user}
          theme={theme}
          connection={connection}
          navigate={navigate}
          onSignOut={onSignOut}
          groupPicker={groupPicker}
          unreadCount={unreadCount}
        />
      }
    >
      <Page class={wide ? "max-w-5xl py-6 sm:py-8" : "max-w-3xl py-6 sm:py-8"}>
        {banner}
        {children}
      </Page>
    </RailShell>
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
