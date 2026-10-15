import type { ComponentChildren, JSX } from "preact"
import { type AuthCredentials, AuthForm } from "@spy4x/preact-system/auth-form"
import { Button } from "@spy4x/preact-ui/button"
import { Link } from "@spy4x/preact-ui/link"
import { AuthCard } from "./auth-screen.tsx"
import { type Navigate, ScreenForm } from "./progressive.tsx"

/**
 * Every page of the admin app (`apps/admin`, #146), which runs on a host of its own. Its routes
 * and its links name these, never a string of their own.
 */
export const ADMIN_PATHS = {
  users: "/",
  user: (userId: number) => `/users/${userId}`,
  signIn: "/sign-in",
  oneTimeCode: "/one-time-code",
} as const

/** The admin app's brand: tells an operator at once that this is not the product. */
function AdminBrand({ navigate }: { navigate?: Navigate }): JSX.Element {
  return (
    <Link
      href={ADMIN_PATHS.users}
      navigate={navigate}
      class="flex shrink-0 items-center gap-2 rounded-md"
    >
      <span
        class="flex size-7 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground"
        aria-hidden="true"
      >
        A
      </span>
      <span class="text-base font-semibold">Template admin</span>
    </Link>
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
