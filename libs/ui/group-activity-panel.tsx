import type { JSX } from "preact"
import { Button } from "@spy4x/preact-ui/button"
import { Card } from "@spy4x/preact-ui/card"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Stack } from "@spy4x/preact-ui/layout"
import { Link } from "@spy4x/preact-ui/link"
import { Rich } from "@spy4x/preact-ui/i18n"
import type { Translator } from "@spy4x/platform/universal/i18n"
import { type ActivityEvent, GroupRole, OPERATOR_DETAIL } from "@domain/groups"
import { type Navigate, NOTE_PATHS } from "./progressive.tsx"
import { When } from "@spy4x/preact-ui/format"
import { useAppText } from "./i18n.ts"
import { roleName } from "./groups-screen.tsx"

/** One event as the API sends it: `at` is an ISO timestamp. */
export type ActivityRow = Omit<ActivityEvent, "at"> & { at: string }

export interface GroupActivityPanelProps {
  /** The newest events first; a later page is added at the end. */
  events: readonly ActivityRow[]
  loading: boolean
  /** A page after the first is on its way. */
  loadingMore?: boolean
  /** More events exist than the list shows. */
  hasMore?: boolean
  /** Reads the next page. Left out, the list offers no "Load more". */
  onLoadMore?: () => void
  /** The error of the read, such as an offline server. */
  error: string | null
  /** The person is a member, but an editor or a viewer: the log is for admins and the owner. */
  forbidden?: boolean
  navigate?: Navigate
}

/**
 * A group's Activity tab: one sentence per event ("Ada moved 3 notes to Family"), when it
 * happened, and a link to the note while it is still in the group. The log pages back in time with
 * "Load more". Only admins and the owner see it; the server refuses everyone else too. The group's
 * page draws the header and the tabs around it.
 */
export function GroupActivityPanel(props: GroupActivityPanelProps): JSX.Element {
  const { events, navigate } = props
  const t = useAppText()
  if (props.forbidden) {
    return (
      <Card data-e2e="activity-forbidden">
        <EmptyState
          headingLevel={2}
          inset
          title={t.t(`GroupActivity.forbidden`)}
          description={t.t(`GroupActivity.forbiddenHint`)}
        />
      </Card>
    )
  }
  return (
    <Stack>
      <ErrorState message={props.error} />
      {events.length === 0
        ? (
          !props.error && (
            <Card>
              <EmptyState
                headingLevel={2}
                inset
                title={props.loading ? t.t(`GroupActivity.loading`) : t.t(`GroupActivity.empty`)}
                description={props.loading ? undefined : t.t(`GroupActivity.emptyHint`)}
              />
            </Card>
          )
        )
        : (
          <Card>
            <ul class="divide-y divide-subtle" data-e2e="activity-list">
              {events.map((event) => (
                <ActivityItem key={event.id} event={event} navigate={navigate} />
              ))}
            </ul>
          </Card>
        )}
      {props.hasMore && props.onLoadMore && (
        <div class="flex justify-center">
          <Button
            variant="outline"
            class="min-h-11 sm:min-h-9"
            disabled={props.loadingMore}
            onClick={props.onLoadMore}
            data-e2e="activity-more"
          >
            {props.loadingMore ? t.t(`GroupActivity.loadingMore`) : t.t(`GroupActivity.loadMore`)}
          </Button>
        </div>
      )}
    </Stack>
  )
}

/**
 * One event: its sentence, then a meta line with when it happened and, while the note is still in
 * the group, an underlined link to it that is a full touch target on a phone.
 */
function ActivityItem(
  { event, navigate }: { event: ActivityRow; navigate?: Navigate },
): JSX.Element {
  const note = event.entity?.type === "note" && event.entity.exists ? event.entity.id : null
  const t = useAppText()
  const title = typeof event.details.title === "string" ? event.details.title.trim() : ""
  return (
    <li
      class="flex min-h-14 flex-col justify-center gap-1 px-4 py-3 sm:px-6"
      data-e2e={`activity-${event.id}`}
    >
      <p class="break-words text-sm font-medium" data-e2e="activity-text">
        <ActivitySentence event={event} />
      </p>
      <p class="flex flex-wrap items-center gap-x-3 text-sm text-muted">
        <When at={event.at} />
        {note && (
          <Link
            href={NOTE_PATHS.note(note)}
            navigate={navigate}
            class="pc-link inline-flex min-h-11 items-center sm:min-h-0"
            data-e2e="activity-note-link"
            aria-label={title
              ? t.t(`GroupActivity.openNoteNamed`, { title })
              : t.t(`GroupActivity.openNote`)}
          >
            {t.t(`GroupActivity.openNote`)}
          </Link>
        )}
      </p>
    </li>
  )
}

/** The catalog key of one event's sentence and the values it fills in. */
export interface ActivityMessage {
  key: string
  values: Record<string, string | number>
  /**
   * The key of the same sentence about "a member", for when the member it names is gone or the
   * event kept none. Set only on the kinds that name a member.
   */
  someone?: string
}

/** A detail that is a non-empty string, else `null`. */
function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null
}

/**
 * The sentence of one event, per kind: `Ada moved 3 notes to Family`. Each kind has a message of
 * its own for every set of facts it may have kept (a title or none, a count or none), so no
 * sentence is built from pieces. `who` and `target` are filled in by {@link ActivitySentence};
 * `title`, `name`, `from`, `to` and `group` are what members typed, `role`, `fromRole` and
 * `toRole` are role numbers the sentence names, and `count` picks the plural form.
 */
export function activityMessage(event: Pick<ActivityEvent, "kind" | "details">): ActivityMessage {
  const { details } = event
  const count = typeof details.count === "number" ? details.count : null
  const group = text(details.groupName)
  const title = text(details.title)
  const name = text(details.name)
  const one = (key: string, values: Record<string, string | number> = {}) => ({ key, values })
  switch (event.kind) {
    case "group.created":
      return one(`GroupActivity.created`)
    case "group.renamed": {
      const from = text(details.from)
      const to = text(details.to)
      return from && to
        ? one(`GroupActivity.renamedFromTo`, { from, to })
        : one(`GroupActivity.renamed`)
    }
    case "group.details_updated":
      return one(`GroupActivity.detailsUpdated`)
    case "group.deleted":
      return one(`GroupActivity.deleted`)
    case "group.restored":
      return one(`GroupActivity.restored`)
    case "group.member_role_changed":
      return typeof details.from === "number"
        ? {
          ...one(`GroupActivity.roleChangedFromTo`, {
            fromRole: details.from,
            toRole: Number(details.to),
          }),
          someone: `GroupActivity.roleChangedFromToSomeone`,
        }
        : { ...one(`GroupActivity.roleChanged`), someone: `GroupActivity.roleChangedSomeone` }
    case "group.member_removed":
      return {
        ...one(`GroupActivity.memberRemoved`),
        someone: `GroupActivity.memberRemovedSomeone`,
      }
    case "group.member_left":
      return one(`GroupActivity.memberLeft`)
    case "group.ownership_transferred":
      return {
        ...one(`GroupActivity.ownershipTransferred`),
        someone: `GroupActivity.ownershipTransferredSomeone`,
      }
    case "group.invitation_created":
      return typeof details.role === "number"
        ? one(`GroupActivity.invitedAs`, { role: details.role })
        : one(`GroupActivity.invited`)
    case "group.invitation_accepted":
      return one(`GroupActivity.invitationAccepted`)
    case "group.invitation_revoked":
      return one(`GroupActivity.invitationRevoked`)
    case "group.invitation_declined":
      return one(`GroupActivity.invitationDeclined`)
    case "group.data_moved_out":
      if (count !== null && group) return one(`GroupActivity.dataMovedOut`, { count, group })
      if (count !== null) return one(`GroupActivity.dataMovedOutElsewhere`, { count })
      if (group) return one(`GroupActivity.dataMovedOutUncounted`, { group })
      return one(`GroupActivity.dataMovedOutUncountedElsewhere`)
    case "group.data_moved_in":
      return count !== null
        ? one(`GroupActivity.dataMovedIn`, { count })
        : one(`GroupActivity.dataMovedInUncounted`)
    case "group.exported":
      return one(`GroupActivity.exported`)
    case "group.imported":
      return count !== null
        ? one(`GroupActivity.imported`, { count })
        : one(`GroupActivity.importedUncounted`)
    case "note.created":
      return title
        ? one(`GroupActivity.noteCreated`, { title })
        : one(`GroupActivity.noteCreatedUntitled`)
    case "note.deleted":
      return title
        ? one(`GroupActivity.noteDeleted`, { title })
        : one(`GroupActivity.noteDeletedUntitled`)
    case "note.restored":
      return title
        ? one(`GroupActivity.noteRestored`, { title })
        : one(`GroupActivity.noteRestoredUntitled`)
    case "note.moved_out":
      if (count !== null && group) return one(`GroupActivity.notesMovedOut`, { count, group })
      if (count !== null) return one(`GroupActivity.notesMovedOutElsewhere`, { count })
      if (group) return one(`GroupActivity.notesMovedOutUncounted`, { group })
      return one(`GroupActivity.notesMovedOutUncountedElsewhere`)
    case "note.moved_in":
      return count !== null
        ? one(`GroupActivity.notesMovedIn`, { count })
        : one(`GroupActivity.notesMovedInUncounted`)
    case "note.attachment.added":
      if (name && title) return one(`GroupActivity.fileAdded`, { name, title })
      if (name) return one(`GroupActivity.fileAddedNoNote`, { name })
      if (title) return one(`GroupActivity.fileAddedUnnamed`, { title })
      return one(`GroupActivity.fileAddedUnnamedNoNote`)
    case "note.attachment.removed":
      if (name && title) return one(`GroupActivity.fileRemoved`, { name, title })
      if (name) return one(`GroupActivity.fileRemovedNoNote`, { name })
      if (title) return one(`GroupActivity.fileRemovedUnnamed`, { title })
      return one(`GroupActivity.fileRemovedUnnamedNoNote`)
    case "tag.created":
      return name
        ? one(`GroupActivity.tagCreated`, { name })
        : one(`GroupActivity.tagCreatedUnnamed`)
    case "tag.updated": {
      const from = text(details.from)
      if (from && name) return one(`GroupActivity.tagRenamed`, { from, name })
      if (!name) return one(`GroupActivity.tagChangedUnnamed`)
      return typeof details.color === "string"
        ? one(`GroupActivity.tagRecoloured`, { name })
        : one(`GroupActivity.tagChanged`, { name })
    }
    case "tag.deleted": {
      const notes = typeof details.notes === "number" && details.notes > 0 ? details.notes : null
      if (name && notes) return one(`GroupActivity.tagDeletedCarried`, { name, count: notes })
      if (notes) return one(`GroupActivity.tagDeletedUnnamedCarried`, { count: notes })
      return name
        ? one(`GroupActivity.tagDeleted`, { name })
        : one(`GroupActivity.tagDeletedUnnamed`)
    }
    default:
      return one(`GroupActivity.unknown`)
  }
}

/** A role's name for a sentence, `Member` for a value the log kept that is no role. */
function roleIn(t: Translator<string>, role: string | number): string {
  return Object.values(GroupRole).includes(role as GroupRole)
    ? roleName(t, role as GroupRole)
    : t.t(`GroupActivity.roleUnknown`)
}

/**
 * One event as a sentence in the person's language. A person's name and what members typed are
 * isolated (`<bdi>`), so a name in another script does not reorder the sentence, and are kept from
 * page translation. An operator reads "Support team", an account that is gone "Deleted user", a
 * person with no name "Someone"; those are the app's own words, so they are translated.
 */
export function ActivitySentence(
  { event }: { event: Pick<ActivityEvent, "kind" | "actor" | "target" | "details"> },
): JSX.Element {
  const t = useAppText()
  const message = activityMessage(event)
  const { values } = message
  const operator = OPERATOR_DETAIL in event.details
  const actorName = operator || event.actor.userId === null ? `` : event.actor.name
  const who = operator
    ? t.t(`GroupActivity.supportTeam`)
    : event.actor.userId === null
    ? t.t(`GroupActivity.deletedUser`)
    : actorName || t.t(`GroupActivity.someone`)
  // A target that is gone, or one the event did not keep, reads "a member": a variant of its own.
  const target = event.target?.userId == null ? `` : event.target.name
  const filled: Record<string, string | number> = { ...values, who, target }
  for (const field of [`role`, `fromRole`, `toRole`]) {
    if (field in values) filled[field] = roleIn(t, values[field])
  }
  const key = message.someone && !target ? message.someone : message.key
  const person = (named: boolean) => (part: string) =>
    named ? <bdi translate={false}>{part}</bdi> : <bdi>{part}</bdi>
  return (
    <Rich
      parts={t.parts(key, filled)}
      tags={{
        who: person(actorName !== ``),
        target: person(true),
        value: (part) => <bdi translate={false}>{part}</bdi>,
      }}
    />
  )
}
