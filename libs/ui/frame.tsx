import type { ComponentChildren, JSX } from "preact"
import { canViewActivity } from "@domain/groups"
import {
  IconAlertTriangle,
  IconBell,
  IconClock,
  IconDocumentText,
  IconTag,
  IconUsers,
} from "@spy4x/preact-icons"
import { AccountMenu } from "@spy4x/preact-system/account-menu"
import {
  RailShell,
  type RailShellItem,
  type RailShellSidebarPlace,
} from "@spy4x/preact-system/rail-shell"
import { Avatar } from "@spy4x/preact-ui/avatar"
import { Button } from "@spy4x/preact-ui/button"
import { Page } from "@spy4x/preact-ui/layout"
import { Link } from "@spy4x/preact-ui/link"
import { Tooltip } from "@spy4x/preact-ui/tooltip"
import {
  GroupPicker,
  type GroupPickerData,
  GroupSheet,
  MENU_TOOLTIP_CLASS,
  placeHook,
} from "./group-picker.tsx"
import {
  GROUP_PATHS,
  type Navigate,
  NOTE_PATHS,
  SCREEN_PATHS,
  ScreenForm,
  TAG_PATHS,
} from "./progressive.tsx"

/**
 * The daily destinations, in the order the sidebar and the phone tab bar show them. Four at most, so
 * the phone bar keeps its last slot for the Account sheet. Activity belongs to the selected group and
 * shows only while there is one whose log the person may read. Profile is in the account menu.
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
  ]
}

/**
 * The navigation entry a path belongs to: a note belongs to Notes, a group's activity log to
 * Activity and any other group page to Groups. The account's pages (profile, e-mail) belong to no
 * entry: they open from the account menu.
 */
export function navKey(path: string | undefined): string | undefined {
  if (path === undefined) return undefined
  if (path === NOTE_PATHS.list || path.startsWith(`${NOTE_PATHS.list}/`)) return "notes"
  if (path === TAG_PATHS.list || path.startsWith(`${TAG_PATHS.list}/`)) return "tags"
  if (/^\/groups\/[^/]+\/activity\/?$/.test(path)) return "activity"
  if (path === SCREEN_PATHS.groups || path.startsWith(`${SCREEN_PATHS.groups}/`)) return "groups"
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

/** The user's full name, else the e-mail address, else "User": how the account entry names them. */
export function displayName(user: FrameUser): string {
  return `${user.firstName} ${user.lastName}`.trim() || user.email || "User"
}

/** The most a badge writes; more reads "99+" so the badge keeps its size. */
const BADGE_MAX = 99

/** The Notifications entry's accessible name: `Notifications`, or `Notifications, 3 unread`. */
export function bellLabel(unreadCount: number): string {
  return unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"
}

/** The look of `RailShell`'s own counters, so every count in the shell reads the same. */
const COUNT_BADGE =
  "h-5 min-w-5 shrink-0 rounded-full bg-primary px-1 text-center text-xs leading-5 font-semibold text-primary-foreground"

/** A row in the sidebar's bottom zone or the phone's sheet: 44 px tall, like `RailShell`'s own. */
const SLOT_ROW =
  "flex min-h-11 w-full min-w-0 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted hover:bg-canvas hover:text-foreground"

/** The rail's cell for one control, the width of the 72 px column. */
const RAIL_CELL =
  "relative flex min-h-11 w-full items-center justify-center rounded-md text-muted hover:bg-canvas hover:text-foreground"

/**
 * The Notifications entry: a link to the inbox with the unread count in a badge while there is any.
 * The count is part of the link's name, so a screen reader hears the real number; the badge is
 * hidden from it. In the rail it is the bell alone, with the name as its tooltip.
 */
function InboxEntry(
  { unreadCount, navigate, place }: {
    unreadCount: number
    navigate?: Navigate
    place: RailShellSidebarPlace
  },
): JSX.Element {
  const label = bellLabel(unreadCount)
  const badge = (extra: string) =>
    unreadCount > 0 && (
      <span
        class={`${COUNT_BADGE} ${extra}`}
        aria-hidden="true"
        data-e2e={placeHook("shell-bell-count", place)}
      >
        {unreadCount > BADGE_MAX ? `${BADGE_MAX}+` : unreadCount}
      </span>
    )
  if (place === "rail") {
    return (
      <Tooltip
        label="Notifications"
        content="Notifications"
        placement="right"
        focusable={false}
        class="flex w-full"
      >
        <Link
          href={SCREEN_PATHS.notifications}
          navigate={navigate}
          aria-label={label}
          class={RAIL_CELL}
          data-e2e={placeHook("shell-bell", place)}
        >
          <IconBell class="size-6" aria-hidden="true" />
          {badge("absolute top-1 left-1/2 ml-2")}
        </Link>
      </Tooltip>
    )
  }
  return (
    <Link
      href={SCREEN_PATHS.notifications}
      navigate={navigate}
      aria-label={label}
      class={SLOT_ROW}
      data-e2e={placeHook("shell-bell", place)}
    >
      <IconBell class="size-6 shrink-0" aria-hidden="true" />
      <span class="min-w-0 flex-1 truncate">Notifications</span>
      {badge("ml-auto")}
    </Link>
  )
}

/**
 * The connection while it is news ({@link connectionIsNews}): a warning chip in the sidebar and the
 * sheet, a warning icon with the text as its tooltip in the rail. Screen readers skip it, because
 * the frame's one live region ({@link AppFrame}) already says it.
 */
function ConnectionChip(
  { status, place }: { status: ConnectionStatus; place: RailShellSidebarPlace },
): JSX.Element {
  const text = CONNECTION_TEXT[status]
  const icon = <IconAlertTriangle class="size-5 shrink-0" aria-hidden="true" />
  if (place === "rail") {
    return (
      <div aria-hidden="true" class="flex w-full" data-e2e={placeHook("shell-ws-chip", place)}>
        <Tooltip
          label={text}
          content={text}
          placement="right"
          focusable={false}
          class="flex w-full"
        >
          <span class="flex min-h-11 w-full items-center justify-center rounded-md bg-warning-soft text-warning">
            {icon}
          </span>
        </Tooltip>
      </div>
    )
  }
  return (
    <div
      aria-hidden="true"
      class="flex min-h-11 items-center gap-2 rounded-md bg-warning-soft px-3 py-2 text-sm font-medium text-warning"
      data-e2e={placeHook("shell-ws-chip", place)}
    >
      {icon}
      <span class="min-w-0 truncate">{text}</span>
    </div>
  )
}

/**
 * The account entry: the library's `AccountMenu` with Profile, the theme and Sign out. The sidebar
 * and the sheet show the avatar, the name and the e-mail; the rail shows the avatar alone with its
 * name as a tooltip.
 */
function AccountEntry(
  { user, theme, navigate, onSignOut, place }: {
    user: FrameUser
    theme?: FrameTheme
    navigate?: Navigate
    onSignOut: () => void
    place: RailShellSidebarPlace
  },
): JSX.Element {
  const name = displayName(user)
  const label = `Account: ${name}`
  // A person known only by the address would read it twice.
  const email = user.email && user.email !== name ? user.email : undefined
  const menu = (
    <AccountMenu
      user={{ name, email }}
      items={[{
        label: "Profile",
        href: SCREEN_PATHS.profile,
        dataE2E: placeHook("shell-menu-profile", place),
      }]}
      theme={theme?.preference.value}
      onThemeChange={theme && ((choice) => theme.set(choice))}
      signOut={{ label: "Sign out", onClick: onSignOut, dataE2E: placeHook("signout", place) }}
      display={place === "rail" ? "avatar" : "full"}
      vertical={place === "overlay" ? "auto" : "up"}
      navigate={navigate}
      dataE2E={placeHook("shell-user-menu-button", place)}
      labels={{ trigger: label }}
    />
  )
  if (place !== "rail") return menu
  return (
    <Tooltip
      label={label}
      content={label}
      placement="right"
      focusable={false}
      class="flex w-full justify-center"
      contentClass={MENU_TOOLTIP_CLASS}
    >
      {menu}
    </Tooltip>
  )
}

/**
 * The signed-in frame, mobile first, with no header: everything around the page lives in
 * `RailShell`'s column, a labelled sidebar from `lg`, a 72 px icon rail from `md`, and a bottom tab
 * bar below that.
 *
 * - The top of the column is the group switcher.
 * - The middle is the destinations ({@link navItems}).
 * - The bottom is the connection while it is not live, Notifications with its unread count, and the
 *   account menu (Profile, Theme, Sign out).
 *
 * On a phone the tab bar's last slot is "Account": the avatar with the unread count, opening a sheet
 * with the groups, Notifications and the account menu. The skip link jumps past the column into
 * `<main>`.
 *
 * The connection has one live region, outside the column so it exists once; its text is always
 * there for screen readers and the e2e specs (`shell-ws-status`).
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
    /** How many notifications are unread. Left out, the sidebar has no Notifications entry. */
    unreadCount?: number
    /** Gives the page the wider column (64 rem), for a data table that needs it. */
    wide?: boolean
    children: ComponentChildren
  },
): JSX.Element {
  const selected = groupPicker?.groups.find((group) => group.id === groupPicker.selectedId)
  const activityGroupId = selected && canViewActivity(selected.role) ? selected.id : null
  const top = groupPicker &&
    ((place: RailShellSidebarPlace) =>
      place === "overlay"
        ? <GroupSheet {...groupPicker} navigate={navigate} />
        : <GroupPicker {...groupPicker} navigate={navigate} place={place} />)
  const bottom = (place: RailShellSidebarPlace) => (
    <div class="flex flex-col gap-1">
      {connection && connectionIsNews(connection) && (
        <ConnectionChip status={connection} place={place} />
      )}
      {unreadCount !== undefined && (
        <InboxEntry unreadCount={unreadCount} navigate={navigate} place={place} />
      )}
      <AccountEntry
        user={user}
        theme={theme}
        navigate={navigate}
        onSignOut={onSignOut}
        place={place}
      />
    </div>
  )
  return (
    <>
      {connection && (
        <span class="sr-only" role="status" data-e2e="shell-ws-status">
          {CONNECTION_TEXT[connection]}
        </span>
      )}
      <RailShell
        items={navItems(activityGroupId)}
        currentKey={navKey(currentPath)}
        navigateLink={navigate && ((_key, href) => navigate(href))}
        sidebarTop={top}
        sidebarBottom={bottom}
        moreTab={{
          icon: <Avatar name={displayName(user)} alt="" size="sm" />,
          counter: unreadCount,
        }}
        labels={{ more: "Account", moreDialog: "Account", counter: (count) => `${count} unread` }}
      >
        <Page class={wide ? "max-w-5xl py-6 sm:py-8" : "max-w-3xl py-6 sm:py-8"}>
          {banner}
          {children}
        </Page>
      </RailShell>
    </>
  )
}

/**
 * The product's mark and name above the signed-out pages. It leads to `/`, which the sign-in gate
 * answers.
 */
function Brand({ navigate }: { navigate?: Navigate }): JSX.Element {
  return (
    <Link
      href={SCREEN_PATHS.profile}
      navigate={navigate}
      class="flex shrink-0 items-center gap-2 rounded-md"
    >
      <span
        class="flex size-7 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground"
        aria-hidden="true"
      >
        S
      </span>
      <span class="text-base font-semibold">Seed</span>
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
