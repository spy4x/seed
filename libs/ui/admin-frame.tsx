import type { ComponentChildren, ComponentType, JSX } from "preact"
import type { IconProps } from "@spy4x/preact-icons"
import { type AuthCredentials, AuthForm } from "@spy4x/preact-system/auth-form"
import { AccountMenu } from "@spy4x/preact-system/account-menu"
import { RailShell, type RailShellSidebarPlace } from "@spy4x/preact-system/rail-shell"
import { Badge } from "@spy4x/preact-ui/badge"
import { Button } from "@spy4x/preact-ui/button"
import { Card } from "@spy4x/preact-ui/card"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { Link } from "@spy4x/preact-ui/link"
import { Stack } from "@spy4x/preact-ui/layout"
import { PageHeader } from "@spy4x/preact-ui/page-header"
import { Tooltip } from "@spy4x/preact-ui/tooltip"
import { AuthCard } from "./auth-screen.tsx"
import type { FrameTheme } from "./frame.tsx"
import { MENU_TOOLTIP_CLASS, placeHook } from "./group-picker.tsx"
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

/**
 * The admin app's brand: the "Admin" badge, which tells an operator at once that this is not the
 * product, and the product's name in muted text. The 72 px rail has room for the badge alone. In
 * the phone's More sheet it is a plain heading row, not a link: the Dashboard tab already leads home,
 * and a link there would leave the sheet open over the new page.
 */
function AdminBrand(
  { navigate, place = "sidebar" }: { navigate?: Navigate; place?: RailShellSidebarPlace },
): JSX.Element {
  const rail = place === "rail"
  if (place === "overlay") {
    return (
      <div class="flex min-h-11 items-center gap-2 px-2">
        <span data-e2e={placeHook("admin-mark", place)}>
          <Badge text="Admin" />
        </span>
        <span class="text-base font-semibold text-muted">Seed</span>
      </div>
    )
  }
  return (
    <Link
      href={ADMIN_PATHS.dashboard}
      navigate={navigate}
      class={rail
        ? "flex min-h-11 w-full items-center justify-center rounded-md"
        : "flex min-h-11 shrink-0 items-center gap-2 rounded-md px-2"}
      aria-label={rail ? "Seed admin" : undefined}
    >
      <span data-e2e={placeHook("admin-mark", place)}>
        <Badge text="Admin" />
      </span>
      {!rail && <span class="text-base font-semibold text-muted">Seed</span>}
    </Link>
  )
}

/** The signed-in operator, as the frame shows them. */
export interface AdminShellOperator {
  name: string
  email: string | null
}

/** One sidebar entry: a module's page. */
export interface AdminNavItem {
  name: string
  href: string
  Icon: ComponentType<IconProps>
}

/**
 * The signed-in admin app's frame (#424, #453), the same shell as the product's: a labelled sidebar
 * from `lg`, a 72 px icon rail from `md` and a bottom tab bar below that, with no header.
 *
 * - The top of the column, and of the phone's More sheet, is the brand with its "Admin" badge.
 * - The middle is one entry per module.
 * - The bottom is the operator's account menu: the theme and Sign out.
 *
 * On a phone the first four modules are tabs and "More" opens a sheet with the rest and the
 * operator's menu. The page sits in a column of at most 64 rem (`max-w-5xl`), the width the design
 * language and `docs/design/ui-layout.md` rule 6 give a page of tables and dashboards.
 */
export function AdminShell(
  { navItems, currentPath, operator, theme, onSignOut, navigate, children }: {
    navItems: readonly AdminNavItem[]
    /** The address of the page shown; the entry whose page it is, or is under, is marked. */
    currentPath: string
    operator: AdminShellOperator
    /** The theme store; left out, the operator's menu offers no theme. */
    theme?: FrameTheme
    onSignOut: () => void
    navigate?: Navigate
    children: ComponentChildren
  },
): JSX.Element {
  const label = `Account: ${operator.name}`
  const account = (place: RailShellSidebarPlace) => (
    <AccountMenu
      user={{ name: operator.name, email: operator.email ?? undefined }}
      theme={theme?.preference.value}
      onThemeChange={theme && ((choice) => theme.set(choice))}
      signOut={{
        label: "Sign out",
        onClick: onSignOut,
        dataE2E: placeHook("admin-signout", place),
      }}
      display={place === "rail" ? "avatar" : "full"}
      vertical={place === "overlay" ? "auto" : "up"}
      navigate={navigate}
      dataE2E={placeHook("admin-operator", place)}
      labels={{ trigger: label }}
    />
  )
  return (
    <RailShell
      items={navItems.map(({ name, href, Icon }) => ({ key: href, label: name, href, Icon }))}
      currentKey={adminNavPath(navItems, currentPath)}
      navigateLink={navigate && ((_key, href) => navigate(href))}
      sidebarTop={(place) => <AdminBrand navigate={navigate} place={place} />}
      sidebarBottom={(place) =>
        place === "rail"
          ? (
            <Tooltip
              label={label}
              content={label}
              placement="right"
              focusable={false}
              class="flex w-full justify-center"
              contentClass={MENU_TOOLTIP_CLASS}
            >
              {account(place)}
            </Tooltip>
          )
          : account(place)}
      labels={{ nav: "Admin sections" }}
    >
      <div class="mx-auto w-full max-w-5xl p-4 pb-12">{children}</div>
    </RailShell>
  )
}

/**
 * The sidebar entry `path` belongs to: the entry whose page it is, or the one whose page it is
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
