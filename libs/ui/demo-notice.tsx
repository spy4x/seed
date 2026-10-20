import type { JSX } from "preact"
import type { AuthCredentials } from "@spy4x/preact-system/auth-form"
import { Button } from "@spy4x/preact-ui/button"
import { CopyButton } from "@spy4x/preact-ui/copy-button"
import { Link } from "@spy4x/preact-ui/link"
import { Notice } from "@spy4x/preact-ui/notice"
import { type Navigate, SCREEN_PATHS } from "./progressive.tsx"

/**
 * The public demo's shared account (docs/demo.md): what to type on the product's sign-in page.
 * The app reads it from `GET /api/demo`.
 */
export interface DemoCredentials {
  login: string
  password: string
}

/** Which page the notice is on. */
export type DemoNoticeKind = "sign-in" | "sign-up"

const RESET_NOTE = `Everything is wiped every night at midnight Pacific time.`

/**
 * The banner above a sign-in card while the public demo is on: it says the demo is shared and
 * wiped nightly, shows the shared credentials with a copy button each, and signs in with them in
 * one press through the page's own `onSignIn`, so busy state and errors are the form's. The form's
 * own button stays the page's one primary action; this one is secondary. On sign-up it only points
 * to the shared account.
 */
export function DemoNotice(
  { demo, kind, busy = false, onSignIn, navigate }: {
    demo: DemoCredentials
    kind: DemoNoticeKind
    busy?: boolean
    onSignIn?: (credentials: AuthCredentials) => void
    navigate?: Navigate
  },
): JSX.Element {
  if (kind === "sign-up") {
    return (
      <Notice
        live={false}
        title="Public demo"
        data-e2e="demo-credentials"
        action={
          <Link href={SCREEN_PATHS.signIn} navigate={navigate} class="pc-link font-medium">
            Use the demo account
          </Link>
        }
      >
        Just looking? Sign in with the shared demo account instead. {RESET_NOTE}
      </Notice>
    )
  }
  return (
    <Notice live={false} title="Public demo" data-e2e="demo-credentials">
      <div class="flex flex-col gap-3">
        <p>Anyone can sign in with this account and see what others add. {RESET_NOTE}</p>
        <dl class="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1">
          <Credential label="E-mail" value={demo.login} copyLabel="Copy e-mail address" />
          <Credential label="Password" value={demo.password} copyLabel="Copy password" />
        </dl>
        <div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            class="w-full sm:w-auto"
            disabled={busy}
            aria-busy={busy}
            data-e2e="demo-sign-in"
            onClick={() => onSignIn?.({ login: demo.login, password: demo.password })}
          >
            Sign in as the demo user
          </Button>
        </div>
      </div>
    </Notice>
  )
}

/** One row of the credentials: the label, the value as selectable text, and its copy button. */
function Credential(
  { label, value, copyLabel }: { label: string; value: string; copyLabel: string },
): JSX.Element {
  return (
    <>
      <dt class="text-sm text-muted">{label}</dt>
      <dd class="min-w-0 break-all font-mono text-sm select-all">{value}</dd>
      <dd>
        <CopyButton textToCopy={value} copyLabel={copyLabel} />
      </dd>
    </>
  )
}
