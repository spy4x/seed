// deno-lint-ignore-file ui-text/no-literal
import type { JSX } from "preact"
import { Button } from "@spy4x/preact-ui/button"
import { Card } from "@spy4x/preact-ui/card"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Stack } from "@spy4x/preact-ui/layout"
import { LoadingSkeleton } from "@spy4x/preact-ui/loading-skeleton"
import { Notice } from "@spy4x/preact-ui/notice"
import { PageHeader } from "@spy4x/preact-ui/page-header"
import { canManageInvitations, type GroupRole } from "@domain/groups"
import { InviteForm, type InviteFormProps } from "./group-invitations.tsx"
import { GROUP_PATHS, SCREEN_PATHS } from "./progressive.tsx"
import { FORM_WIDTH, useWaited } from "./tag-editor-screen.tsx"

/** The words an invitation needs a connection for; the notice and a refused submit say the same. */
export const INVITATION_OFFLINE =
  "Creating an invitation needs a connection. Try again when you are back online."

export interface InvitationNewScreenProps
  extends Omit<InviteFormProps, "groupId" | "actorRole" | "formError"> {
  /** The group's id, from the address. */
  groupId: string
  /** The group and the person's role in it, once known; `null` while read or when not found. */
  group: { name: string; role: GroupRole } | null
  /** The groups are being read. */
  loading: boolean
  /** Why the groups could not be read, or `null`. */
  error?: string | null
  /** The device has no network: creating an invitation needs one, which the page says first. */
  offline?: boolean
  /** A submit was refused while offline: the form says so above its buttons. */
  refusedOffline?: boolean
}

/**
 * `/groups/:groupId/invitations/new`: makes an invitation to a group. An invitation is never
 * edited, so this page only creates. First the form; once the invitation exists, the same page
 * shows its link, once, with a copy control and Done, which goes back to the group's page. A
 * member who may not invite, or a group the person is not in, gets a sentence and a way back.
 */
export function InvitationNewScreen(props: InvitationNewScreenProps): JSX.Element {
  const { groupId, group, loading, error = null, offline = false, created, navigate } = props
  const waited = useWaited(loading && !group)
  const back = { href: GROUP_PATHS.members(groupId), label: "Back to the members" }
  if (group && created) {
    return (
      <Stack gap="xl">
        <PageHeader
          title="Copy your invitation link"
          titleDataE2E="invitation-new-title"
          subtitle={group.name}
        />
        <div class={FORM_WIDTH}>
          <InviteForm {...props} groupId={groupId} actorRole={group.role} />
        </div>
      </Stack>
    )
  }
  return (
    <Stack gap="xl">
      <PageHeader
        title="New invitation"
        titleDataE2E="invitation-new-title"
        subtitle={group?.name}
        back={back}
        navigate={navigate}
      />
      {group
        ? canManageInvitations(group.role)
          ? (
            <>
              {offline && (
                <div data-e2e="invitation-offline" class={FORM_WIDTH}>
                  <Notice title="You are offline">{INVITATION_OFFLINE}</Notice>
                </div>
              )}
              <div class={FORM_WIDTH}>
                <InviteForm
                  {...props}
                  groupId={groupId}
                  actorRole={group.role}
                  formError={props.refusedOffline && offline ? INVITATION_OFFLINE : null}
                />
              </div>
            </>
          )
          : (
            <div data-e2e="invitation-not-allowed">
              <Card>
                <EmptyState
                  inset
                  headingLevel={2}
                  title="Only an admin or the owner can invite people."
                  action={
                    <Button href={back.href} navigate={navigate} variant="outline">
                      Back to the group
                    </Button>
                  }
                />
              </Card>
            </div>
          )
        : error
        ? <ErrorState message={error} />
        : loading
        ? (
          // Nothing for a short read, so a fast one does not flash; a placeholder after that.
          waited && (
            <div data-e2e="invitation-loading">
              <p role="status" class="sr-only">Loading the group…</p>
              <LoadingSkeleton rows={1} class={FORM_WIDTH} />
            </div>
          )
        )
        : (
          <div data-e2e="invitation-group-missing">
            <Card>
              <EmptyState
                inset
                headingLevel={2}
                title="This group does not exist."
                description="It may have been deleted, or you are not a member."
                action={
                  <Button href={SCREEN_PATHS.groups} navigate={navigate} variant="outline">
                    Back to groups
                  </Button>
                }
              />
            </Card>
          </div>
        )}
    </Stack>
  )
}
