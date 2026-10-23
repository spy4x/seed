import type { JSX } from "preact"
import { useEffect, useRef } from "preact/hooks"
import { Button } from "@spy4x/preact-ui/button"
import { Card } from "@spy4x/preact-ui/card"
import { CopyBlock } from "@spy4x/preact-ui/copy-block"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Input } from "@spy4x/preact-ui/input"
import { LoadingSkeleton } from "@spy4x/preact-ui/loading-skeleton"
import { Stack } from "@spy4x/preact-ui/layout"
import { Notice } from "@spy4x/preact-ui/notice"
import { PageHeader } from "@spy4x/preact-ui/page-header"
import { RadioGroup } from "@spy4x/preact-ui/radio"
import { API_TOKEN_EXPIRY_DAYS, type ApiToken, ApiTokenAccess } from "@domain/api-tokens"
import { ApiDocsLink } from "./api-tokens.tsx"
import { type Navigate, profilePath, ScreenForm } from "./progressive.tsx"
import { FORM_WIDTH, useWaited } from "./tag-editor-screen.tsx"

/**
 * The create form's fields. `expiresInDays` is `null` for a token that never expires; `password`
 * is the person's current one, which the API asks for before it makes a token.
 */
export interface ApiTokenFormValues {
  name: string
  password: string
  groupId: string
  access: ApiTokenAccess
  expiresInDays: number | null
}

/** A group a token may be made for. */
export interface ApiTokenGroupOption {
  id: string
  name: string
}

/** The create form's errors: one per field that can be refused, and one for the form. */
export interface ApiTokenFormErrors {
  name: string | null
  /** The password is missing or not the current one. */
  password: string | null
  /** Why the create failed, when no field owns it; shown under the form. */
  form: string | null
}

export interface ApiTokenNewScreenProps {
  /** The groups the person may make a token for; `null` while they are read. */
  groups: readonly ApiTokenGroupOption[] | null
  values: ApiTokenFormValues
  onValueChange: <K extends keyof ApiTokenFormValues>(
    field: K,
    value: ApiTokenFormValues[K],
  ) => void
  errors: ApiTokenFormErrors
  /** A create is in flight. */
  pending: boolean
  /**
   * The token just made and its secret. Given, the page shows the secret, once, in place of the
   * form. The app forgets it on Done and when the page closes: it is never shown again.
   */
  created: { token: ApiToken; secret: string } | null
  /** The device has no network: making a token needs one, which the page says above the form. */
  offline?: boolean
  onCreate: () => void
  /** Done, after the secret: the app forgets it and goes back to the profile. */
  onDone: () => void
  navigate?: Navigate
  /** The API reference on the product's website; without one, no link to it shows. */
  docsHref?: string | null
}

/** The words a create needs a connection for; the notice and a refused submit say the same. */
export const API_TOKEN_OFFLINE =
  "Creating a token needs a connection. Try again when you are back online."

const NEVER = "never"

const EXPIRY_OPTIONS = [
  ...API_TOKEN_EXPIRY_DAYS.map((days) => ({ value: String(days), label: `${days} days` })),
  { value: NEVER, label: "Never" },
]

const ACCESS_OPTIONS = [
  { value: ApiTokenAccess.READ, label: "Read only" },
  { value: ApiTokenAccess.WRITE, label: "Read and write" },
]

const BACK = { href: profilePath("api-tokens"), label: "Back to API tokens" }

/**
 * `/tokens/new`: makes an API token. A token is never edited, so this page only creates. First the
 * form (name, group, access, expiry and the person's password); once the token exists, the same
 * page shows its secret, once, with a copy control and Done, which goes back to the profile.
 */
export function ApiTokenNewScreen(props: ApiTokenNewScreenProps): JSX.Element {
  const { groups, created, navigate, docsHref } = props
  const waited = useWaited(groups === null)
  if (created) {
    return (
      <Stack gap="xl">
        <PageHeader title="Copy your token" titleDataE2E="api-token-new-title" />
        <CreatedSecret secret={created.secret} onDone={props.onDone} docsHref={docsHref} />
      </Stack>
    )
  }
  return (
    <Stack gap="xl">
      <PageHeader
        title="New API token"
        titleDataE2E="api-token-new-title"
        back={BACK}
        navigate={navigate}
      />
      {docsHref && (
        <p class="text-sm text-muted">
          A token lets a script use one group through the API.{" "}
          <ApiDocsLink href={docsHref} dataE2E="api-token-docs">Read the API docs</ApiDocsLink>
        </p>
      )}
      {groups === null
        ? waited && (
          <div data-e2e="api-token-loading">
            <p role="status" class="sr-only">Loading your groups…</p>
            <LoadingSkeleton rows={1} class={FORM_WIDTH} />
          </div>
        )
        : groups.length === 0
        ? (
          <div data-e2e="api-token-no-group">
            <Card>
              <EmptyState
                inset
                headingLevel={2}
                title="You are not in a group you can make a token for."
                action={
                  <Button href={profilePath("api-tokens")} navigate={navigate} variant="outline">
                    Back to profile
                  </Button>
                }
              />
            </Card>
          </div>
        )
        : <CreateForm {...props} groups={groups} />}
    </Stack>
  )
}

function CreateForm(
  { groups, values, onValueChange, errors, pending, offline = false, onCreate, navigate }:
    & ApiTokenNewScreenProps
    & { groups: readonly ApiTokenGroupOption[] },
): JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  // A refused submit lands the person on the first field to fix, or on the message under the form.
  useEffect(() => {
    const first = errors.name ? "name" : errors.password ? "password" : null
    if (first) box.current?.querySelector<HTMLElement>(`[name=${first}]`)?.focus()
  }, [errors.name, errors.password])

  return (
    <>
      {offline && (
        <div data-e2e="api-token-offline" class={FORM_WIDTH}>
          <Notice title="You are offline">{API_TOKEN_OFFLINE}</Notice>
        </div>
      )}
      <ScreenForm pending={pending} onSubmit={onCreate}>
        <div ref={box} class={FORM_WIDTH}>
          <Stack>
            <Field
              id="api-token-name"
              label="Name"
              hint={`So you can tell your tokens apart, such as "Backup script".`}
              error={errors.name}
              required
            >
              <Input
                data-e2e="api-token-name"
                name="name"
                autocomplete="off"
                value={values.name}
                onInput={(e) => onValueChange("name", e.currentTarget.value)}
                required
              />
            </Field>
            <RadioGroup
              legend="Group"
              name="groupId"
              data-e2e="api-token-group"
              options={groups.map((group) => ({ value: group.id, label: group.name }))}
              value={values.groupId}
              onChange={(value) => onValueChange("groupId", value)}
            />
            <RadioGroup
              legend="Access"
              name="access"
              data-e2e="api-token-access"
              options={ACCESS_OPTIONS}
              value={values.access}
              onChange={(value) =>
                onValueChange(
                  "access",
                  Number(value) === ApiTokenAccess.WRITE
                    ? ApiTokenAccess.WRITE
                    : ApiTokenAccess.READ,
                )}
            />
            <RadioGroup
              legend="Expires after"
              name="expiresInDays"
              data-e2e="api-token-expiry"
              options={EXPIRY_OPTIONS}
              value={values.expiresInDays === null ? NEVER : String(values.expiresInDays)}
              onChange={(value) =>
                onValueChange("expiresInDays", value === NEVER ? null : Number(value))}
            />
            <Field
              id="api-token-password"
              label="Your password"
              hint="A token works without your password, so creating one asks for it."
              error={errors.password}
              required
            >
              <Input
                data-e2e="api-token-password"
                name="password"
                type="password"
                autocomplete="current-password"
                value={values.password}
                onInput={(e) => onValueChange("password", e.currentTarget.value)}
                required
              />
            </Field>
            <ErrorState focusOnAppear message={errors.form} dataE2E="api-token-error" />
            {
              // On a phone the primary button is on top at full width, Cancel under it; from `sm`
              // up they are a row at the right, the primary button last.
            }
            <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                href={profilePath("api-tokens")}
                navigate={navigate}
                variant="ghost"
                class="min-h-11 w-full sm:min-h-9 sm:w-auto"
                data-e2e="api-token-cancel"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                class="min-h-11 w-full sm:min-h-9 sm:w-auto"
                data-e2e="api-token-create"
                busy={pending}
                busyLabel="Creating…"
              >
                Create token
              </Button>
            </div>
          </Stack>
        </div>
      </ScreenForm>
    </>
  )
}

/**
 * The secret, once: a warning that it will not be shown again, a copy control, how to send it
 * (with a link to the reference's quick start) and Done. Focus moves to the copy control, the one
 * thing to do next.
 */
function CreatedSecret(
  { secret, onDone, docsHref }: { secret: string; onDone: () => void; docsHref?: string | null },
): JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>("button")?.focus()
  }, [])
  return (
    <Stack class={FORM_WIDTH}>
      <p class="text-sm">
        Copy this token now and keep it somewhere safe. You will not be able to see it again.
      </p>
      <div ref={box} data-e2e="api-token-secret">
        <CopyBlock text={secret} copyLabel="Copy token" copiedLabel="Token copied" />
      </div>
      {docsHref && (
        <p class="text-sm text-muted">
          Send it as <code>Authorization: Bearer &lt;your token&gt;</code>.{" "}
          <ApiDocsLink href={`${docsHref}#quick-start`} dataE2E="api-token-secret-docs">
            See the quick start
          </ApiDocsLink>
        </p>
      )}
      <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          class="min-h-11 w-full sm:min-h-9 sm:w-auto"
          data-e2e="api-token-done"
          onClick={onDone}
        >
          Done
        </Button>
      </div>
    </Stack>
  )
}
