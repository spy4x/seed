import type { ComponentChildren, ComponentType, JSX } from "preact"
import type { IconProps } from "@spy4x/preact-icons"
import { type AuthCredentials, AuthForm } from "@spy4x/preact-system/auth-form"
import { AccountTag } from "@spy4x/preact-system/account-menu"
import { AppShell } from "@spy4x/preact-system/app-shell"
import { Badge } from "@spy4x/preact-ui/badge"
import { Button } from "@spy4x/preact-ui/button"
import { Card } from "@spy4x/preact-ui/card"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { Link } from "@spy4x/preact-ui/link"
import { Stack } from "@spy4x/preact-ui/layout"
import { PageHeader } from "@spy4x/preact-ui/page-header"
import { AuthCard } from "./auth-screen.tsx"
import { type FrameShortcuts, type FrameTheme, shortcutsMenuItems } from "./frame.tsx"
import { ShortcutsList } from "./shortcuts.tsx"
import { type Navigate, ScreenForm } from "./progressive.tsx"

/**
 * The pages of the admin app (`apps/admin`, #146) that its screens link to. It runs on a host of
 * its own. Its routes and its links name these, never a string of their own; a module's own page
 * names its path in its module (`apps/admin/src/modules/`).
 */
export const ADMIN_PATHS = {
  dashboard: "/",
  users: "/users",
  user: (userId: number) => `/users/${userId}`,
  signIn: "/sign-in",
  oneTimeCode: "/one-time-code",
} as const

// Seed's own site: see docs/start-a-product.md
/** The product's name, the last part of every admin page's title. */
export const ADMIN_PRODUCT = "Seed"

/** The word that marks the operator area: the account cell's badge and the titles' middle part. */
const ADMIN_TAG = "Admin"

/**
 * The signed-out admin pages' brand: the product's name and the neutral "Admin" badge, which tells
 * an operator at once that this is not the product. The signed-in shell has no brand; the same
 * badge sits under the operator's avatar in the rail instead.
 */
function AdminBrand({ navigate }: { navigate?: Navigate }): JSX.Element {
  return (
    <Link
      href={ADMIN_PATHS.dashboard}
      navigate={navigate}
      class="-ml-2 flex min-h-11 shrink-0 items-center gap-2 rounded-md px-2"
    >
      <span class="text-base font-semibold text-foreground">{ADMIN_PRODUCT}</span>
      <span data-e2e="admin-mark">
        <AccountTag tag={ADMIN_TAG} />
      </span>
    </Link>
  )
}

/** The signed-in operator, as the frame shows them. */
export interface AdminShellOperator {
  name: string
  email: string | null
}

/** One rail entry: a module's page. */
export interface AdminNavItem {
  name: string
  href: string
  Icon: ComponentType<IconProps>
}

/**
 * The signed-in admin app's frame (#424, #453, #516): the library's `AppShell`, the same shell as
 * the product's, so the two look made by one person.
 *
 * - The rail's top zone is empty: there is no group switcher, because operators work across every
 *   group, and no brand, which would repeat the Dashboard entry.
 * - The middle is one entry per module, Dashboard first.
 * - The bottom is the operator's account menu (the theme and Sign out), with a neutral "Admin"
 *   badge under the avatar, so the cell an operator checks says where they are signed in.
 *
 * On a phone the first four modules are tabs and the last tab, "Admin", opens a sheet with the rest
 * and the operator's menu. The page sits in the wide column of 64 rem, the width the design
 * language and `docs/design/ui-layout.md` rule 6 give a page of tables and dashboards.
 */
export function AdminShell(
  { navItems, currentPath, operator, theme, onSignOut, navigate, shortcuts, children }: {
    navItems: readonly AdminNavItem[]
    /** The address of the page shown; the entry whose page it is, or is under, is marked. */
    currentPath: string
    operator: AdminShellOperator
    /** The theme store; left out, the operator's menu offers no theme. */
    theme?: FrameTheme
    onSignOut: () => void
    navigate?: Navigate
    /** The admin app's keyboard shortcuts and their dialog. Left out, the shell binds none. */
    shortcuts?: FrameShortcuts
    children: ComponentChildren
  },
): JSX.Element {
  return (
    <AppShell
      items={navItems.map(({ name, href, Icon }) => ({ key: href, label: name, href, Icon }))}
      currentPath={currentPath}
      navigate={navigate}
      account={{
        // An operator known only by the address would read it twice.
        user: {
          name: operator.name,
          email: operator.email && operator.email !== operator.name ? operator.email : undefined,
        },
        items: shortcutsMenuItems(shortcuts),
        theme: theme?.preference.value,
        onThemeChange: theme && ((choice) => theme.set(choice)),
        signOut: { label: "Sign out", onClick: onSignOut },
        tag: ADMIN_TAG,
      }}
      width="wide"
      labels={{ nav: "Admin sections" }}
    >
      {children}
      {shortcuts && <ShortcutsList {...shortcuts} />}
    </AppShell>
  )
}

/**
 * The browser tab's title for an admin page: `Users · Admin · Seed`, named after the entry whose
 * page it is or is under, so the tab itself says it is the operator area. A page under no entry
 * reads `Admin · Seed`.
 */
export function adminPageTitle(
  navItems: readonly Pick<AdminNavItem, "href" | "name">[],
  path: string,
): string {
  const href = adminNavPath(navItems, path)
  const page = navItems.find((item) => item.href === href)?.name
  return [page, ADMIN_TAG, ADMIN_PRODUCT].filter(Boolean).join(" · ")
}

/**
 * The rail entry `path` belongs to: the entry whose page it is, or the one whose page it is
 * under (`/users/42` is under `/users`). The dashboard at `/` owns only itself.
 */
export function adminNavPath(
  navItems: readonly Pick<AdminNavItem, "href">[],
  path: string,
): string {
  let best = ""
  for (const { href } of navItems) {
    const under = href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`)
    if (under && href.length > best.length) best = href
  }
  return best || path
}

/**
 * The page of a module that has nothing yet (#424): its title and a quiet "coming soon". It tells
 * an operator the section exists and is planned, not broken.
 */
export function AdminComingSoon(
  { title, description, Icon }: {
    title: string
    description: string
    Icon?: ComponentType<IconProps>
  },
): JSX.Element {
  return (
    <Stack>
      <PageHeader title={title} titleDataE2E="admin-module-title" />
      <ComingSoonPanel title={`${title} is coming soon`} description={description} Icon={Icon} />
    </Stack>
  )
}

/** The "coming soon" panel itself, for a page and for a person tab alike. */
export function ComingSoonPanel(
  { title, description, Icon }: {
    title: string
    description: string
    Icon?: ComponentType<IconProps>
  },
): JSX.Element {
  return (
    // A card with the empty state in its body's place: no dashed box beside the page's solid cards.
    <Card data-e2e="admin-coming-soon">
      <EmptyState
        inset
        icon={Icon && <Icon class="size-8 text-muted" aria-hidden="true" />}
        title={title}
        headingLevel={2}
        description={description}
        action={<Badge text="Coming soon" color="gray" />}
      />
    </Card>
  )
}

/**
 * The admin app's frame: the brand, the operator's name and Sign out above a column of at most 64
 * rem. Signed out, it has the brand only and a narrow column for the sign-in card.
 */
export function AdminFrame(
  { operatorName, canSignOut, onSignOut, navigate, wide = true, children }: {
    /** The signed-in operator's name, or `null` while nobody is. */
    operatorName: string | null
    /** A session exists, even one that still owes its code: Sign out ends it. */
    canSignOut: boolean
    onSignOut: () => void
    navigate?: Navigate
    /** `false` for the sign-in pages, which take a narrow column. */
    wide?: boolean
    children: ComponentChildren
  },
): JSX.Element {
  const column = wide ? "max-w-5xl" : "max-w-md"
  return (
    <div class="flex min-h-dvh flex-col">
      <header
        class={`mx-auto flex w-full ${column} items-center justify-between gap-4 px-4 pt-6 pb-4`}
      >
        <AdminBrand navigate={navigate} />
        <div class="flex min-w-0 items-center gap-2">
          {operatorName && (
            <span class="hidden truncate text-sm text-muted sm:inline" data-e2e="admin-operator">
              {operatorName}
            </span>
          )}
          {canSignOut && (
            <ScreenForm onSubmit={onSignOut}>
              <Button type="submit" variant="ghost" data-e2e="admin-signout">Sign out</Button>
            </ScreenForm>
          )}
        </div>
      </header>
      <main class={`mx-auto w-full ${column} px-4 pb-12`}>{children}</main>
    </div>
  )
}

/**
 * The admin app's sign-in: the password, then the authenticator code when two-factor is on. There
 * is no sign-up, no password reset and no Google or GitHub here; those stay in the product.
 */
export function AdminSignInScreen(
  { step, busy, error, onSignIn, onOneTimeCode }: {
    step: "credentials" | "one-time-code"
    busy: boolean
    error: string | null
    onSignIn: (credentials: AuthCredentials) => void
    onOneTimeCode: (code: string) => void
  },
): JSX.Element {
  const credentials = step === "credentials"
  return (
    <AuthCard
      title={credentials ? "Operator sign-in" : "Enter your code"}
      description={credentials
        ? "For operators of this product. Sign in with your e-mail address and password."
        : "Open your authenticator app and enter the six digits it shows."}
      e2e="admin-sign-in"
    >
      <AuthForm
        mode="sign-in"
        step={step}
        busy={busy}
        error={error}
        labels={{
          login: "E-mail or username",
          submitCode: "Continue",
          codeHint: "Six digits from your authenticator app.",
        }}
        names={{ login: "login", code: "otp" }}
        onSignIn={onSignIn}
        onOneTimeCode={onOneTimeCode}
      />
    </AuthCard>
  )
}

/**
 * What a signed-in person below operator sees: no list, no detail, only the way out. The API
 * refuses them on its own; this page only says so.
 */
export function AdminNoAccess(): JSX.Element {
  return (
    <AuthCard
      title="No access"
      description="This account is not an operator. Sign out, then sign in with an operator's account."
      e2e="admin-no-access"
    >
      <p class="text-sm text-muted">
        An administrator gives the role with <code>deno task user:role</code>.
      </p>
    </AuthCard>
  )
}
