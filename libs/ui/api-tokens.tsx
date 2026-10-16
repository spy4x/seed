import type { JSX } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { timeAgo } from "@spy4x/platform/universal/time"
import { IconKey } from "@spy4x/preact-icons"
import { Badge } from "@spy4x/preact-ui/badge"
import { Button } from "@spy4x/preact-ui/button"
import { ConfirmDialog } from "@spy4x/preact-ui/confirm-dialog"
import { CopyBlock } from "@spy4x/preact-ui/copy-block"
import { Card } from "@spy4x/preact-ui/card"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Input } from "@spy4x/preact-ui/input"
import { Cluster, Stack } from "@spy4x/preact-ui/layout"
import { Modal } from "@spy4x/preact-ui/modal"
import { RadioGroup } from "@spy4x/preact-ui/radio"
import { SavedCopyNotice } from "@spy4x/preact-system/saved-copy-notice"
import { API_TOKEN_EXPIRY_DAYS, type ApiToken, ApiTokenAccess } from "@domain/api-tokens"
import { TOUCH_TARGET } from "@spy4x/preact-ui/page-header"
import { ScreenForm } from "./progressive.tsx"
import { SettingGroup, SettingList, SettingRow } from "@spy4x/preact-ui/setting-row"

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

export interface ApiTokensProps {
  /** Live tokens, newest first; `null` while the list is not known yet. */
  tokens: readonly ApiToken[] | null
  /** The groups the person may make a token for. Without any, "Create token" is left out. */
  groups: readonly ApiTokenGroupOption[]
  values: ApiTokenFormValues
  onValueChange: <K extends keyof ApiTokenFormValues>(
    field: K,
    value: ApiTokenFormValues[K],
  ) => void
  errors: {
    /** Why the list could not be read or a revoke failed; shown above the list. */
    list: string | null
    /** The name's own error, tied to its field. */
    name: string | null
    /** The password's own error, tied to its field: it is missing or not the current one. */
    password: string | null
    /** Why the create failed, when the API tied it to no field; shown under the form. */
    form: string | null
  }
  pending: { create: boolean; revoke: boolean }
  /**
   * When the list was taken from the server, in epoch milliseconds, while it is the copy saved on
   * this device (the server is unreachable). The screen then says how old the list is. Leave it
   * out, or pass `null`, for the server's answer.
   */
  savedAt?: number | null
  /**
   * The token just created and its secret, shown once in the dialog with a copy control. `null`
   * once the person closed it: the secret is never available again.
   */
  created: { token: ApiToken; secret: string } | null
  /** Opens the create dialog: the app resets the form's values and errors. */
  onStartCreate: () => void
  onCreate: () => void
  /** The person closed the secret: the app forgets it. */
  onDismissSecret: () => void
  /** Revokes one token, after the person confirmed. */
  onRevoke: (tokenId: string) => void
}

const NEVER = "never"

const EXPIRY_OPTIONS = [
  ...API_TOKEN_EXPIRY_DAYS.map((days) => ({ value: String(days), label: `${days} days` })),
  { value: NEVER, label: "Never" },
]

const ACCESS_OPTIONS = [
  { value: ApiTokenAccess.READ, label: "Read only" },
  { value: ApiTokenAccess.WRITE, label: "Read and write" },
]

/**
 * The words of the notice over a saved copy of this list. The title names the list, because the
 * signed-in devices' notice sits on the same page and a screen reader would hear two identical ones.
 */
const API_TOKENS_SAVED_COPY_LABELS = {
  title: "Saved copy of your API tokens",
  body: (time: string) =>
    `The server is out of reach. This list was saved on this device: ${time}. Tokens created or revoked since then are missing from it.`,
}

/**
 * "API tokens" on the profile: each live token with its group, access, expiry and last use, and
 * "Revoke", which asks first. "Create token" opens a dialog; once the token is made the same
 * dialog shows its secret, once, with a copy control.
 */
export function ApiTokens(props: ApiTokensProps): JSX.Element {
  const { tokens, groups, errors, pending, created, savedAt } = props
  const [creating, setCreating] = useState(false)
  const [revoking, setRevoking] = useState<ApiToken | null>(null)

  const startCreate = () => {
    props.onStartCreate()
    setCreating(true)
  }
  const close = () => {
    setCreating(false)
    if (created) props.onDismissSecret()
  }
  const createButton = groups.length > 0 && (
    <Button
      type="button"
      variant="secondary"
      data-e2e="api-token-create-open"
      onClick={startCreate}
    >
      Create token
    </Button>
  )

  return (
    <SettingGroup
      title="API tokens"
      description="Let a script or another service use one of your groups without your password. Changing or resetting your password revokes every token."
      dataE2E="api-tokens"
    >
      <ErrorState message={errors.list} />
      <SavedCopyNotice
        savedAt={savedAt}
        labels={API_TOKENS_SAVED_COPY_LABELS}
        data-e2e="api-tokens-saved-copy"
      />
      {tokens === null
        ? <p class="text-sm text-muted">Loading your tokens…</p>
        : tokens.length === 0
        ? (
          <Card>
            {/* Inside the section's own card, like every other section, not a dashed box. */}
            <EmptyState
              icon={<IconKey class="size-6" />}
              title="No API tokens"
              headingLevel={3}
              inset
              description="A token acts as you in one group, read only or read and write."
              action={createButton || undefined}
            />
          </Card>
        )
        : (
          <>
            <SettingList>
              {tokens.map((token) => (
                <SettingRow
                  key={token.id}
                  dataE2E={`api-token-${token.id}`}
                  label={token.name}
                  value={<TokenDetails token={token} />}
                  action={
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      class={TOUCH_TARGET}
                      data-e2e={`api-token-revoke-${token.id}`}
                      disabled={pending.revoke}
                      onClick={() => setRevoking(token)}
                    >
                      Revoke <span class="sr-only">{token.name}</span>
                    </Button>
                  }
                />
              ))}
            </SettingList>
            {createButton && <div>{createButton}</div>}
          </>
        )}

      <Modal
        open={creating || created !== null}
        onClose={close}
        title={created ? "Copy your token" : "Create API token"}
        cancelLabel="Close"
        dataE2E="api-token-dialog"
      >
        {created
          ? <CreatedSecret secret={created.secret} onDone={close} />
          : <CreateForm {...props} onCancel={close} />}
      </Modal>

      {revoking && (
        <ConfirmDialog
          title={`Revoke ${revoking.name}?`}
          message="Anything that uses this token stops working at once. This cannot be undone."
          confirmLabel="Revoke"
          cancelLabel="Cancel"
          tone="danger"
          dataE2E="api-token-revoke-confirm"
          onCancel={() => setRevoking(null)}
          onConfirm={() => {
            setRevoking(null)
            props.onRevoke(revoking.id)
          }}
        />
      )}
    </SettingGroup>
  )
}

function CreateForm(
  { groups, values, onValueChange, errors, pending, onCreate, onCancel }: ApiTokensProps & {
    onCancel: () => void
  },
): JSX.Element {
  const nameInput = useRef<HTMLInputElement>(null)
  const passwordInput = useRef<HTMLInputElement>(null)
  // A failed submit lands the person on the first field to fix.
  useEffect(() => {
    if (errors.name) nameInput.current?.focus()
    else if (errors.password) passwordInput.current?.focus()
  }, [errors.name, errors.password])

  return (
    <ScreenForm pending={pending.create} onSubmit={onCreate}>
      <Stack>
        <Field id="api-token-name" label="Name" error={errors.name} required>
          <Input
            ref={nameInput}
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
              Number(value) === ApiTokenAccess.WRITE ? ApiTokenAccess.WRITE : ApiTokenAccess.READ,
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
            ref={passwordInput}
            data-e2e="api-token-password"
            name="password"
            type="password"
            autocomplete="current-password"
            value={values.password}
            onInput={(e) => onValueChange("password", e.currentTarget.value)}
            required
          />
        </Field>
        <ErrorState message={errors.form} />
        <Cluster justify="end">
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button
            type="submit"
            data-e2e="api-token-create"
            busy={pending.create}
            busyLabel="Creating..."
          >
            Create token
          </Button>
        </Cluster>
      </Stack>
    </ScreenForm>
  )
}

/**
 * The secret, once: a copy control and a warning that it will not be shown again. Focus moves to
 * the copy control, the one thing to do next.
 */
function CreatedSecret({ secret, onDone }: { secret: string; onDone: () => void }): JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>("button")?.focus()
  }, [])
  return (
    <Stack>
      <p class="text-sm">
        Copy this token now and keep it somewhere safe. You will not be able to see it again.
      </p>
      <div ref={box} data-e2e="api-token-secret">
        <CopyBlock text={secret} copyLabel="Copy token" copiedLabel="Token copied" />
      </div>
      <Cluster justify="end">
        <Button type="button" data-e2e="api-token-done" onClick={onDone}>Done</Button>
      </Cluster>
    </Stack>
  )
}

/**
 * The group and access on one line, then when the token expires and when it was last used, one
 * line each, so a narrow screen never strands a separator.
 */
function TokenDetails({ token }: { token: ApiToken }): JSX.Element {
  return (
    <span class="flex flex-col items-start gap-1" data-e2e="api-token-details">
      <span class="flex flex-wrap items-center gap-2">
        <span>{token.groupName}</span>
        <Badge
          text={token.access === ApiTokenAccess.WRITE ? "Read and write" : "Read only"}
          color={token.access === ApiTokenAccess.WRITE ? "orange" : "gray"}
          type="outline"
        />
      </span>
      <span>
        {token.expiresAt
          ? (
            <>
              Expires <time dateTime={token.expiresAt}>{formatDate(token.expiresAt)}</time>
            </>
          )
          : "Never expires"}
      </span>
      <span>
        {token.lastUsedAt
          ? (
            <>
              Last used <time dateTime={token.lastUsedAt}>{timeAgo(token.lastUsedAt)}</time>
            </>
          )
          : "Never used"}
      </span>
    </span>
  )
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(iso))
}
