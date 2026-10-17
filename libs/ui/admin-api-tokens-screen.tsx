import type { ComponentChildren, JSX, RefObject } from "preact"
import { useEffect, useRef } from "preact/hooks"
import { Avatar } from "@spy4x/preact-ui/avatar"
import { Badge } from "@spy4x/preact-ui/badge"
import { Button } from "@spy4x/preact-ui/button"
import { Card } from "@spy4x/preact-ui/card"
import { ConfirmDialog } from "@spy4x/preact-ui/confirm-dialog"
import { DataTable, type DataTableColumn } from "@spy4x/preact-ui/data-table"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Link } from "@spy4x/preact-ui/link"
import { Stack } from "@spy4x/preact-ui/layout"
import { LoadingSkeleton } from "@spy4x/preact-ui/loading-skeleton"
import { PageHeader } from "@spy4x/preact-ui/page-header"
import { ToggleChips } from "@spy4x/preact-ui/toggle-chips"
import {
  ADMIN_API_TOKEN_STATES,
  type AdminApiToken,
  type AdminApiTokenFilter,
  type AdminApiTokenListResponse,
  type AdminApiTokenState,
  ApiTokenAccess,
} from "@domain/api-tokens"
import { ADMIN_PATHS } from "./admin-frame.tsx"
import { adminUserName } from "./admin-users-screen.tsx"
import type { Navigate } from "./progressive.tsx"
import { OnDay, When } from "@spy4x/preact-ui/format"

/** The page's address in the admin app. */
export const ADMIN_API_TOKENS_PATH = "/api-tokens"

/** What each state is called, on its chip and its badge. */
const STATE_LABELS: Record<AdminApiTokenState, string> = {
  live: "Live",
  expired: "Expired",
  revoked: "Revoked",
}

/**
 * What the operator is about to do and to what: revoke a token, or remove one of a person's push
 * devices. The dialog names the thing so the operator sees what they confirm.
 */
export type AdminTokensConfirm =
  | { kind: "revoke"; token: AdminApiToken }
  | { kind: "remove-device"; userId: number; deviceId: number; label: string }

/** The open confirm dialog, or `null`. */
export interface AdminTokensConfirmState {
  target: AdminTokensConfirm | null
  /** Why the API refused, shown in the dialog; `null` before an answer. */
  error: string | null
  pending: boolean
}

export interface AdminApiTokensScreenProps {
  /** What the address asked for; the chips start from it. */
  filter: AdminApiTokenFilter
  /** The page of tokens, or `null` while it loads. */
  list: AdminApiTokenListResponse | null
  pending: boolean
  /** Why the list could not be read, or `null`. */
  error: string | null
  /** The signed-in operator's id: their own tokens offer no revoke here. */
  operatorId: number
  /** The operator picked a state: the app reads page 1 of it. */
  onFilter: (filter: AdminApiTokenFilter) => void
  onPage: (page: number) => void
  confirm: AdminTokensConfirmState
  onAsk: (target: AdminTokensConfirm) => void
  onCloseConfirm: () => void
  onConfirm: () => void
  navigate?: Navigate
}

/**
 * The API tokens page (#427): every token of everyone, newest first, with its owner, group and
 * access, its state and dates. Chips filter by state and show how many tokens each holds. A live
 * token can be revoked after a confirm; the API writes the audit row on its owner.
 */
export function AdminApiTokensScreen(props: AdminApiTokensScreenProps): JSX.Element {
  const { filter, list, pending, error, onFilter, onPage } = props
  const heading = useRef<HTMLHeadingElement>(null)

  // After a page change the list is new: the reader starts again at its heading.
  const page = list?.page
  const shown = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (page === undefined) return
    if (shown.current !== undefined && shown.current !== page) heading.current?.focus()
    shown.current = page
  }, [page])

  useFocusAfterConfirm(props.confirm, heading)

  const chips = ADMIN_API_TOKEN_STATES.map((state) => ({
    value: state,
    label: list ? `${STATE_LABELS[state]} (${list.counts[state]})` : STATE_LABELS[state],
  }))

  return (
    <Stack>
      <PageHeader
        title="API tokens"
        subtitle="Every API token, whose it is and when it was last used."
        titleDataE2E="admin-api-tokens-title"
      />
      <div
        class="flex flex-wrap items-center gap-2 rounded-xl border border-subtle bg-surface p-4"
        data-e2e="admin-api-tokens-state"
      >
        <span class="text-sm text-muted" aria-hidden="true">State</span>
        <ToggleChips
          mode="single"
          label="State"
          options={chips}
          value={filter.state}
          onChange={(value) =>
            onFilter({ state: (value as AdminApiTokenState | null) ?? null, page: 1 })}
        />
      </div>

      <ErrorState message={error} />

      <h2 ref={heading} tabIndex={-1} class="text-sm text-muted" data-e2e="admin-api-tokens-count">
        {list ? `${list.total} ${list.total === 1 ? "token" : "tokens"}` : "Loading tokens"}
      </h2>
      {list === null
        ? !error && (
          <div role="status" aria-label="Loading tokens">
            <LoadingSkeleton rows={5} />
          </div>
        )
        : (
          <div data-e2e="admin-api-tokens-list" aria-busy={pending}>
            <DataTable
              mode="server"
              class={tokenTableClass(true)}
              columns={tokenColumns({ ...props, withOwner: true })}
              rows={list.tokens}
              sort={[]}
              onSortChange={() => {}}
              caption="API tokens"
              captionHidden
              rowKey={(token) => token.id}
              empty={
                <EmptyState
                  inset
                  title={filter.state ? `No ${filter.state} tokens` : "No API tokens yet"}
                  description={filter.state
                    ? "Pick another state to see the rest."
                    : "A person makes one on their profile, for a script or an integration."}
                />
              }
              paging={{
                page: list.page,
                pageSize: list.pageSize,
                total: list.total,
                onChange: onPage,
                label: "Pages of tokens",
              }}
            />
          </div>
        )}
      <AdminTokensConfirmDialog
        confirm={props.confirm}
        onClose={props.onCloseConfirm}
        onConfirm={props.onConfirm}
      />
    </Stack>
  )
}

/**
 * The classes of a token table, the groups list's phone pattern: below `sm` only the token's cell
 * and its Revoke button stay, so nothing scrolls sideways; the cell then names the owner and the
 * state itself. Positions follow {@link tokenColumns}: with the owner, 1 owner, 3 state, 4 last
 * used and 5 expires; without it, 2 state, 3 last used and 4 expires.
 */
export function tokenTableClass(withOwner: boolean): string {
  return [
    `[&>div:first-child]:min-h-0`,
    `max-sm:[&_:is(th,td)]:px-3`,
    withOwner
      ? `max-sm:[&_:is(th,td):is(:nth-child(1),:nth-child(3),:nth-child(4),:nth-child(5))]:hidden`
      : `max-sm:[&_:is(th,td):is(:nth-child(2),:nth-child(3),:nth-child(4))]:hidden`,
  ].join(` `)
}

/**
 * The columns of a token table: the owner (on the page, not on a person's tab), the name with its
 * group, access and creation day, the state, when it was last used and expires, and the revoke
 * button. On a phone the name's cell also names the owner and the state ({@link tokenTableClass}).
 */
export function tokenColumns(
  { operatorId, onAsk, navigate, withOwner }: {
    operatorId: number
    onAsk: (target: AdminTokensConfirm) => void
    navigate?: Navigate
    withOwner: boolean
  },
): DataTableColumn<AdminApiToken, never>[] {
  const columns: DataTableColumn<AdminApiToken, never>[] = [
    {
      id: "name",
      header: "Token",
      render: (token) => (
        <span class="flex min-w-36 flex-col gap-1">
          <span class="font-medium wrap-anywhere" data-e2e="admin-api-token-name">
            {token.name}
          </span>
          <span class="flex flex-wrap items-center gap-2 text-sm text-muted">
            <span class="wrap-anywhere">{token.groupName ?? "Deleted group"}</span>
            <AccessBadge access={token.access} />
          </span>
          <span class="text-sm text-muted">
            Created <Day at={token.createdAt} />
          </span>
          {/* A phone hides the owner and state columns, so the cell says both. */}
          <span
            class="flex flex-col gap-1 text-sm text-muted sm:hidden"
            data-e2e="admin-api-token-phone"
          >
            {withOwner && <OwnerLine token={token} />}
            <span>
              <Badge
                text={STATE_LABELS[token.state]}
                color={stateColor(token.state)}
                type="outline"
              />
            </span>
          </span>
        </span>
      ),
    },
    {
      id: "state",
      header: "State",
      render: (token) => <StateBadge state={token.state} />,
    },
    {
      id: "lastUsedAt",
      header: "Last used",
      render: (token) =>
        token.lastUsedAt
          ? <Ago at={token.lastUsedAt} />
          : <span class="text-sm text-muted">Never</span>,
    },
    {
      id: "expiresAt",
      header: "Expires",
      render: (token) =>
        token.revokedAt
          ? (
            <span class="text-sm text-muted">
              Revoked <Day at={token.revokedAt} />
            </span>
          )
          : token.expiresAt
          ? <Day at={token.expiresAt} />
          : <span class="text-sm text-muted">Never</span>,
    },
    {
      id: "actions",
      header: "Actions",
      align: "right",
      render: (token) =>
        token.state === "live" && token.owner.id !== operatorId
          ? (
            <Button
              variant="ghost"
              size="sm"
              // 44 px tall on a phone, the touch target of the house accessibility rules.
              class="max-sm:min-h-11"
              data-e2e={`admin-api-token-revoke-${token.id}`}
              aria-label={`Revoke ${token.name}`}
              onClick={() => onAsk({ kind: "revoke", token })}
            >
              Revoke
            </Button>
          )
          : null,
    },
  ]
  if (!withOwner) return columns
  return [
    {
      id: "owner",
      header: "Owner",
      render: (token) => <OwnerCell token={token} navigate={navigate} />,
    },
    ...columns,
  ]
}

/**
 * Moves focus to `target` once a confirmed revoke or removal succeeded: the dialog closes after a
 * pending request, with no error. The row's button that opened the dialog is gone then (a revoked
 * token has no Revoke), so the dialog's own focus restore would leave focus on the page's body. A
 * cancel, or a refusal that keeps the dialog open, leaves focus where the dialog puts it.
 */
export function useFocusAfterConfirm(
  confirm: AdminTokensConfirmState,
  target: RefObject<HTMLElement>,
): void {
  const wasPending = useRef(false)
  useEffect(() => {
    if (wasPending.current && confirm.target === null && confirm.error === null) {
      target.current?.focus()
    }
    wasPending.current = confirm.pending
  }, [confirm])
}

/** The confirm dialog of a revoke or a device removal: what it does, and why the API refused. */
export function AdminTokensConfirmDialog(
  { confirm, onClose, onConfirm }: {
    confirm: AdminTokensConfirmState
    onClose: () => void
    onConfirm: () => void
  },
): JSX.Element | null {
  const { target, error, pending } = confirm
  if (!target) return null
  const copy = target.kind === "revoke"
    ? {
      title: "Revoke this API token",
      text: (
        <>
          <strong class="wrap-anywhere">{target.token.name}</strong> of{" "}
          {adminUserName({ ...target.token.owner })}{" "}
          stops working at once: every script that uses it is refused. It cannot be turned back on;
          its owner can make a new one.
        </>
      ),
      submit: "Revoke",
      busy: "Revoking…",
    }
    : {
      title: "Remove this device",
      text: (
        <>
          Device <strong>{target.label}</strong>{" "}
          gets no more push notifications. The person can turn them on again from that device.
        </>
      ),
      submit: "Remove",
      busy: "Removing…",
    }
  return (
    <ConfirmDialog
      title={copy.title}
      tone="danger"
      confirmLabel={copy.submit}
      busy={pending}
      busyLabel={copy.busy}
      onConfirm={() => {
        onConfirm()
        return false
      }}
      onCancel={onClose}
      dataE2E="admin-api-tokens-dialog"
      confirmDataE2E="admin-api-tokens-confirm"
    >
      <Stack>
        <p class="text-sm text-muted">{copy.text}</p>
        <ErrorState message={error} />
      </Stack>
    </ConfirmDialog>
  )
}

/** A token's access, worded and coloured as the person's own token list shows it. */
export function AccessBadge({ access }: { access: ApiTokenAccess }): JSX.Element {
  const write = access === ApiTokenAccess.WRITE
  return (
    <Badge
      text={write ? "Read and write" : "Read only"}
      color={write ? "orange" : "gray"}
      type="outline"
    />
  )
}

/** A token's state: a live one is good news, a revoked one stands out, an expired one stays quiet. */
export function StateBadge({ state }: { state: AdminApiTokenState }): JSX.Element {
  return (
    <span data-e2e={`admin-api-token-state-${state}`}>
      <Badge text={STATE_LABELS[state]} color={stateColor(state)} type="outline" />
    </span>
  )
}

function stateColor(state: AdminApiTokenState): "green" | "red" | "gray" {
  return state === "live" ? "green" : state === "revoked" ? "red" : "gray"
}

/**
 * The owner inside a token's cell on a phone, as the groups list names a group's owner there: the
 * name, then the address when the name is not already it. The link to their page is the owner
 * column's, which a phone hides.
 */
function OwnerLine({ token }: { token: AdminApiToken }): JSX.Element {
  const name = adminUserName({ ...token.owner })
  return (
    <span class="flex flex-col">
      <span class="wrap-anywhere">
        Owner: <span class="font-medium text-foreground">{name}</span>
      </span>
      {token.owner.email && token.owner.email !== name && (
        <span class="wrap-anywhere">{token.owner.email}</span>
      )}
    </span>
  )
}

/** A day, with the exact moment for a machine and on hover. */
export function Day({ at }: { at: string }): JSX.Element {
  return <OnDay class="whitespace-nowrap text-sm" at={at} />
}

/** A moment as "3 days ago", with the exact time for a machine and on hover. */
export function Ago({ at }: { at: string }): JSX.Element {
  return <When class="whitespace-nowrap text-sm" at={at} />
}

/** The owner column: their avatar, their name as the link to their page, and their address. */
function OwnerCell(
  { token, navigate }: { token: AdminApiToken; navigate?: Navigate },
): JSX.Element {
  const name = adminUserName({ ...token.owner })
  return (
    // At least 12rem wide: on a phone the table scrolls sideways instead of squeezing the name.
    <div class="flex min-w-48 items-center gap-3">
      <Avatar name={name} size="sm" />
      <div class="flex min-w-0 flex-col">
        <Link
          href={`${ADMIN_PATHS.user(token.owner.id)}?tab=api-tokens`}
          navigate={navigate}
          class="pc-link font-medium wrap-anywhere"
          data-e2e={`admin-api-token-owner-${token.owner.id}`}
        >
          {name}
        </Link>
        {/* A person with no name is shown by their address already. */}
        {token.owner.email && token.owner.email !== name && (
          <span class="text-sm text-muted wrap-anywhere">{token.owner.email}</span>
        )}
      </div>
    </div>
  )
}

/** A list in the person page's bordered style, or a card with one quiet line when it is empty. */
export function PanelRows(
  { empty, dataE2E, children }: { empty: string; dataE2E: string; children: ComponentChildren[] },
): JSX.Element {
  if (children.length === 0) {
    return (
      // The list's card with one quiet line in its body's place: no dashed box inside the page.
      <Card data-e2e={dataE2E}>
        <EmptyState inset description={empty} />
      </Card>
    )
  }
  return (
    <ul
      class="divide-y divide-subtle overflow-hidden rounded-lg border border-subtle bg-surface"
      data-e2e={dataE2E}
    >
      {children}
    </ul>
  )
}

/** One row of {@link PanelRows}. */
export const PANEL_ROW = "flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"
