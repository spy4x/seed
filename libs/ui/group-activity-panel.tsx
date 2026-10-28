// deno-lint-ignore-file ui-text/no-literal
import type { JSX } from "preact"
import { Button } from "@spy4x/preact-ui/button"
import { Card } from "@spy4x/preact-ui/card"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Stack } from "@spy4x/preact-ui/layout"
import { Link } from "@spy4x/preact-ui/link"
import { type ActivityEvent, describeActivity } from "@domain/groups"
import { type Navigate, NOTE_PATHS } from "./progressive.tsx"
import { When } from "@spy4x/preact-ui/format"

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
  if (props.forbidden) {
    return (
      <Card data-e2e="activity-forbidden">
        <EmptyState
          headingLevel={2}
          inset
          title="Only admins and the owner can see the activity."
          description="Ask an admin if you need to know what changed."
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
                title={props.loading ? "Loading the activity…" : "Nothing has happened yet."}
                description={props.loading
                  ? undefined
                  : "Changes to the group and its notes show up here."}
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
            {props.loadingMore ? "Loading…" : "Load more"}
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
  const title = typeof event.details.title === "string" ? event.details.title.trim() : ""
  return (
    <li
      class="flex min-h-14 flex-col justify-center gap-1 px-4 py-3 sm:px-6"
      data-e2e={`activity-${event.id}`}
    >
      <p class="break-words text-sm font-medium" data-e2e="activity-text">
        {describeActivity(event)}
      </p>
      <p class="flex flex-wrap items-center gap-x-3 text-sm text-muted">
        <When at={event.at} />
        {note && (
          <Link
            href={NOTE_PATHS.note(note)}
            navigate={navigate}
            class="pc-link inline-flex min-h-11 items-center sm:min-h-0"
            data-e2e="activity-note-link"
            aria-label={title ? `Open the note “${title}”` : "Open the note"}
          >
            Open the note
          </Link>
        )}
      </p>
    </li>
  )
}
