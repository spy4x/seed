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
import { Rich } from "@spy4x/preact-ui/i18n"
import { API_TOKEN_MESSAGES, ApiDocsLink, tokenMessage } from "./api-tokens.tsx"
import { useAppText } from "./i18n.ts"
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

/**
 * The create form's errors: one per field that can be refused, and one for the form. Each is one of
 * {@link API_TOKEN_MESSAGES}, shown in the person's language, or the API's own message.
 */
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

/**
 * The words a create needs a connection for, by key; the notice and a refused submit say the same.
 */
export const API_TOKEN_OFFLINE = API_TOKEN_MESSAGES.offline

const NEVER = "never"

/**
 * `/tokens/new`: makes an API token. A token is never edited, so this page only creates. First the
 * form (name, group, access, expiry and the person's password); once the token exists, the same
 * page shows its secret, once, with a copy control and Done, which goes back to the profile.
 */
export function ApiTokenNewScreen(props: ApiTokenNewScreenProps): JSX.Element {
  const { groups, created, navigate, docsHref } = props
  const waited = useWaited(groups === null)
  const t = useAppText()
  if (created) {
    return (
      <Stack gap="xl">
        <PageHeader title={t.t(`ApiTokenNewScreen.copyTitle`)} titleDataE2E="api-token-new-title" />
        <CreatedSecret secret={created.secret} onDone={props.onDone} docsHref={docsHref} />
      </Stack>
    )
  }
  return (
    <Stack gap="xl">
      <PageHeader
        title={t.t(`ApiTokenNewScreen.title`)}
        titleDataE2E="api-token-new-title"
        back={{ href: profilePath("api-tokens"), label: t.t(`ApiTokenNewScreen.back`) }}
        navigate={navigate}
      />
      {docsHref && (
        <p class="text-sm text-muted">
          {t.t(`ApiTokenNewScreen.intro`)}{" "}
          <ApiDocsLink href={docsHref} dataE2E="api-token-docs">
            {t.t(`ApiTokenNewScreen.docs`)}
          </ApiDocsLink>
        </p>
      )}
      {groups === null
        ? waited && (
          <div data-e2e="api-token-loading">
            <p role="status" class="sr-only">{t.t(`ApiTokenNewScreen.loadingGroups`)}</p>
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
                title={t.t(`ApiTokenNewScreen.noGroup`)}
                action={
                  <Button href={profilePath("api-tokens")} navigate={navigate} variant="outline">
                    {t.t(`ApiTokenNewScreen.backToProfile`)}
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
  const t = useAppText()
  // A refused submit lands the person on the first field to fix, or on the message under the form.
  useEffect(() => {
    const first = errors.name ? "name" : errors.password ? "password" : null
    if (first) box.current?.querySelector<HTMLElement>(`[name=${first}]`)?.focus()
  }, [errors.name, errors.password])

  return (
    <>
      {offline && (
        <div data-e2e="api-token-offline" class={FORM_WIDTH}>
          <Notice title={t.t(`ApiTokenNewScreen.offlineTitle`)}>{t.t(API_TOKEN_OFFLINE)}</Notice>
        </div>
      )}
      <ScreenForm pending={pending} onSubmit={onCreate}>
        <div ref={box} class={FORM_WIDTH}>
          <Stack>
            <Field
              id="api-token-name"
              label={t.t(`ApiTokenNewScreen.name`)}
              hint={t.t(`ApiTokenNewScreen.nameHint`)}
              error={tokenMessage(t, errors.name)}
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
              legend={t.t(`ApiTokenNewScreen.group`)}
              name="groupId"
              data-e2e="api-token-group"
              options={groups.map((group) => ({ value: group.id, label: group.name }))}
              value={values.groupId}
              onChange={(value) => onValueChange("groupId", value)}
            />
            <RadioGroup
              legend={t.t(`ApiTokenNewScreen.access`)}
              name="access"
              data-e2e="api-token-access"
              options={[
                { value: ApiTokenAccess.READ, label: t.t(`ApiTokens.readOnly`) },
                { value: ApiTokenAccess.WRITE, label: t.t(`ApiTokens.readWrite`) },
              ]}
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
              legend={t.t(`ApiTokenNewScreen.expiresAfter`)}
              name="expiresInDays"
              data-e2e="api-token-expiry"
              options={[
                ...API_TOKEN_EXPIRY_DAYS.map((count) => ({
                  value: String(count),
                  label: t.t(`ApiTokenNewScreen.days`, { count }),
                })),
                { value: NEVER, label: t.t(`ApiTokenNewScreen.never`) },
              ]}
              value={values.expiresInDays === null ? NEVER : String(values.expiresInDays)}
              onChange={(value) =>
                onValueChange("expiresInDays", value === NEVER ? null : Number(value))}
            />
            <Field
              id="api-token-password"
              label={t.t(`ApiTokenNewScreen.password`)}
              hint={t.t(`ApiTokenNewScreen.passwordHint`)}
              error={tokenMessage(t, errors.password)}
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
            <ErrorState
              focusOnAppear
              message={tokenMessage(t, errors.form)}
              dataE2E="api-token-error"
            />
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
                {t.t(`ApiTokenNewScreen.cancel`)}
              </Button>
              <Button
                type="submit"
                class="min-h-11 w-full sm:min-h-9 sm:w-auto"
                data-e2e="api-token-create"
                busy={pending}
                busyLabel={t.t(`ApiTokenNewScreen.creating`)}
              >
                {t.t(`ApiTokenNewScreen.create`)}
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
  const t = useAppText()
  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>("button")?.focus()
  }, [])
  return (
    <Stack class={FORM_WIDTH}>
      <p class="text-sm">{t.t(`ApiTokenNewScreen.copyNow`)}</p>
      <div ref={box} data-e2e="api-token-secret">
        <CopyBlock
          text={secret}
          copyLabel={t.t(`ApiTokenNewScreen.copy`)}
          copiedLabel={t.t(`ApiTokenNewScreen.copied`)}
        />
      </div>
      {docsHref && (
        <p class="text-sm text-muted">
          <Rich
            parts={t.parts(`ApiTokenNewScreen.sendAs`, {
              header: `Authorization: Bearer <${t.t(`ApiTokenNewScreen.yourToken`)}>`,
            })}
            tags={{ code: (text) => <code>{text}</code> }}
          />{" "}
          <ApiDocsLink href={`${docsHref}#quick-start`} dataE2E="api-token-secret-docs">
            {t.t(`ApiTokenNewScreen.quickStart`)}
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
          {t.t(`ApiTokenNewScreen.done`)}
        </Button>
      </div>
    </Stack>
  )
}
