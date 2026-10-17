import type { ComponentChildren, JSX } from "preact"
import { canViewActivity } from "@domain/groups"
import { IconClock, IconDocumentText, IconSprout, IconTag, IconUsers } from "@spy4x/preact-icons"
import {
  AppShell,
  type AppShellConnection,
  type AppShellItem,
} from "@spy4x/preact-system/app-shell"
import { BrandMark } from "@spy4x/preact-ui/brand-mark"
import { Button } from "@spy4x/preact-ui/button"
import { Link } from "@spy4x/preact-ui/link"
import { GroupPicker, type GroupPickerData, GroupSheet } from "./group-picker.tsx"
import {
  GROUP_PATHS,
  type Navigate,
  NOTE_PATHS,
  SCREEN_PATHS,
  ScreenForm,
  TAG_PATHS,
} from "./progressive.tsx"

/**
 * The daily destinations, in the order the rail and the phone tab bar show them. Four at most, so
 * the phone bar keeps its last slot for the Account sheet. Activity belongs to the selected group and
 * shows only while there is one whose log the person may read. Profile is in the account menu.
 */
export function navItems(activityGroupId: string | null): AppShellItem[] {
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

/** Where the live connection to the API stands; the shell shows it while it is not live. */
export type ConnectionStatus = AppShellConnection

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

/**
 * The signed-in frame: the library's `AppShell`, which draws every piece of chrome the same way in
 * every app, fed with this product's data.
 *
 * - The top of the 72 px rail is the group switcher ({@link GroupPicker}).
 * - The middle is the destinations ({@link navItems}).
 * - The bottom is the connection while it is not live, Notifications with its unread count, and the
 *   account menu (Profile, Theme, Sign out).
 *
 * On a phone the tab bar's last slot is "Account": the avatar with the unread count, opening a sheet
 * with the groups ({@link GroupSheet}), Notifications and the account's choices.
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
    /** The address of the page shown: its entry is marked, and a page inside a section marks it. */
    currentPath?: string
    navigate?: Navigate
    onSignOut: () => void
    groupPicker?: GroupPickerData
    banner?: ComponentChildren
    /** How many notifications are unread. Left out, the rail has no bell. */
    unreadCount?: number
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
  return (
    <AppShell
      items={navItems(activityGroupId)}
      currentPath={currentPath}
      navigate={navigate}
      switcher={groupPicker &&
        ((place) =>
          place === "sheet"
            ? <GroupSheet {...groupPicker} navigate={navigate} />
            : <GroupPicker {...groupPicker} navigate={navigate} />)}
      notifications={unreadCount === undefined
        ? undefined
        : { href: SCREEN_PATHS.notifications, unread: unreadCount }}
      account={{
        user: { name, email },
        items: [{ label: "Profile", href: SCREEN_PATHS.profile }],
        theme: theme?.preference.value,
        onThemeChange: theme && ((choice) => theme.set(choice)),
        signOut: { label: "Sign out", onClick: onSignOut },
      }}
      connection={connection}
      banner={banner}
      width={wide ? "wide" : "default"}
    >
      {children}
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
      href={SCREEN_PATHS.profile}
      navigate={navigate}
      class="flex shrink-0 items-center gap-2 rounded-md"
    >
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
