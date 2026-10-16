import type { ComponentChildren, JSX } from "preact"
import { IconBell, IconDocumentText, IconUser, IconUsers } from "@spy4x/preact-icons"
import { RailShell, type RailShellItem } from "@spy4x/preact-system/rail-shell"
import { Avatar } from "@spy4x/preact-ui/avatar"
import { badgeClasses } from "@spy4x/preact-ui/badge"
import { Button } from "@spy4x/preact-ui/button"
import { Dropdown, DropdownItem } from "@spy4x/preact-ui/dropdown"
import { followLinkClick, Link } from "@spy4x/preact-ui/link"
import { GroupPicker, type GroupPickerData } from "./group-picker.tsx"
import { type Navigate, NOTE_PATHS, SCREEN_PATHS, ScreenForm } from "./progressive.tsx"

/** Every page a signed-in user can open from the navigation, in the order it shows them. */
const NAV_ITEMS: readonly RailShellItem[] = [
  { key: "notes", label: "Notes", href: NOTE_PATHS.list, Icon: IconDocumentText },
  { key: "groups", label: "Groups", href: SCREEN_PATHS.groups, Icon: IconUsers },
  { key: "profile", label: "Profile", href: SCREEN_PATHS.profile, Icon: IconUser },
]

/**
 * The navigation entry a path belongs to: a note belongs to Notes, a group's settings to Groups,
 * and the e-mail page to Profile, where it is opened from.
 */
export function navKey(path: string | undefined): string | undefined {
  if (path === undefined) return undefined
  if (path === NOTE_PATHS.list || path.startsWith(`${NOTE_PATHS.list}/`)) return "notes"
  if (path === SCREEN_PATHS.groups || path.startsWith(`${SCREEN_PATHS.groups}/`)) return "groups"
  if (path === SCREEN_PATHS.profile || path === SCREEN_PATHS.email) return "profile"
  return undefined
}

/** The column the account pages (profile, e-mail address) sit in, narrower than the frame's. */
export const ACCOUNT_COLUMN = "w-full max-w-2xl"

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

/** The name the user menu shows. */
export interface FrameUser {
  firstName: string
  lastName: string
}

function Brand({ navigate, compact }: { navigate?: Navigate; compact?: boolean }): JSX.Element {
  return (
    <Link
      href={SCREEN_PATHS.profile}
      navigate={navigate}
      class="flex shrink-0 items-center gap-2 rounded-md"
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

/** Accessible name for the user menu: the user's full name, or "User" before they set one. */
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
      class="relative flex min-h-11 min-w-11 items-center justify-center rounded-full text-muted hover:text-foreground sm:min-h-9 sm:min-w-9"
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

/**
 * The signed-in frame, mobile first: a bottom tab bar on a phone and a rail from `md` up
 * (`RailShell`), and a slim header with the brand, the current group, the connection while it is
 * not live, the inbox's bell with its unread count, and the user menu holding Sign out. The page
 * sits in a column of at most 64 rem; `banner` shows above every page, such as the request to
 * verify the e-mail address, as wide as the page's own column ({@link ACCOUNT_COLUMN} on the
 * account pages). Signed-out screens use {@link PublicFrame} instead.
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
    children,
  }: {
    user: FrameUser
    connection?: ConnectionStatus
    currentPath?: string
    navigate?: Navigate
    onSignOut: () => void
    groupPicker?: GroupPickerData
    banner?: ComponentChildren
    /** How many notifications are unread. Left out, the header has no bell. */
    unreadCount?: number
    children: ComponentChildren
  },
): JSX.Element {
  return (
    <div
      onClick={(event) => {
        const link = (event.target as Element | null)?.closest?.(
          `a[data-e2e="rail-shell-entry"]`,
        )
        const href = link?.getAttribute("href")
        if (href) followLinkClick(event, { href, navigate })
      }}
    >
      <RailShell items={NAV_ITEMS} currentKey={navKey(currentPath)}>
        <header class="sticky top-0 z-20 border-b border-subtle bg-surface">
          <div class="mx-auto flex h-14 w-full max-w-5xl items-center gap-3 px-4 sm:px-6 lg:px-8">
            <Brand navigate={navigate} compact />
            {groupPicker && <GroupPicker {...groupPicker} />}
            <div class="ml-auto flex shrink-0 items-center gap-2">
              {connection && <ConnectionState status={connection} />}
              {unreadCount !== undefined && (
                <NotificationBell unreadCount={unreadCount} navigate={navigate} />
              )}
              <Dropdown
                trigger={<Avatar name={displayName(user)} size="sm" />}
                triggerNamedByContent
                triggerDataE2E="shell-user-menu-button"
                triggerClasses="flex min-h-11 min-w-11 items-center justify-center rounded-full"
                menuLabel="Account menu"
              >
                <DropdownItem onClick={onSignOut} dataE2E="signout">Sign out</DropdownItem>
              </Dropdown>
            </div>
          </div>
        </header>
        <div class="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          {navKey(currentPath) === "profile"
            ? <div class={`${ACCOUNT_COLUMN} empty:hidden`}>{banner}</div>
            : banner}
          {children}
        </div>
      </RailShell>
    </div>
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
