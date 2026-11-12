import type { JSX } from "preact"
import { Button } from "@spy4x/preact-ui/button"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { useFormat, When } from "@spy4x/preact-ui/format"
import { LoadingSkeleton } from "@spy4x/preact-ui/loading-skeleton"
import { Modal } from "@spy4x/preact-ui/modal"
import { RadioGroup } from "@spy4x/preact-ui/radio"
import { Stack } from "@spy4x/preact-ui/layout"
import type { BlogRevision, BlogRevisionSummary } from "@domain/blog"
import { useAdminText } from "./i18n.ts"

/**
 * The blog editor's History: a post's earlier versions, newest first, and the one picked,
 * read-only. "Restore this version" puts its fields in the editor as unsaved changes; nothing is
 * overwritten until the operator saves, so it asks for no confirmation.
 *
 * @module
 */

/** Where History stands: the list, the version picked, and what failed. */
export interface BlogHistoryState {
  /** The earlier versions, newest first, or `null` while they load. */
  revisions: readonly BlogRevisionSummary[] | null
  /** Why the list could not be read, or `null`. */
  listError: string | null
  /** The version picked in the list, or `null` before the list loaded. */
  selectedId: string | null
  /** The picked version with every field, once read; `null` while it loads. */
  selected: BlogRevision | null
  /** Why the picked version could not be read, or `null`. */
  selectedError: string | null
}

/** History before anything is read. */
export const NO_BLOG_HISTORY: BlogHistoryState = {
  revisions: null,
  listError: null,
  selectedId: null,
  selected: null,
  selectedError: null,
}

export interface BlogHistoryDialogProps {
  history: BlogHistoryState
  /** The time the list's "3 minutes ago" counts from. */
  now: Date
  onSelect: (id: string) => void
  onRestore: (revision: BlogRevision) => void
  /** Reads the list again, or the picked version, whichever failed. */
  onRetry: () => void
  onClose: () => void
}

/**
 * The History dialog. The list is a radio group, so the arrow keys move through it and the version
 * under focus is the one shown; on a phone the version shows under the list, from `lg` beside it.
 * Escape and Cancel close it, and focus goes back to "More actions".
 */
export function BlogHistoryDialog(props: BlogHistoryDialogProps): JSX.Element {
  const t = useAdminText()
  const { revisions, listError, selected } = props.history
  const restorable = revisions !== null && revisions.length > 0
  return (
    <Modal
      open
      onClose={props.onClose}
      title={t.t(`AdminBlogHistory.title`)}
      dataE2E="admin-blog-history"
      class="max-w-5xl!"
      footer={
        <>
          <Button variant="outline" data-e2e="admin-blog-history-cancel" onClick={props.onClose}>
            {t.t(`AdminBlogDialogs.cancel`)}
          </Button>
          {restorable && (
            <Button
              disabled={selected === null}
              data-e2e="admin-blog-history-restore"
              onClick={() => selected && props.onRestore(selected)}
            >
              {t.t(`AdminBlogHistory.restore`)}
            </Button>
          )}
        </>
      }
    >
      {listError !== null
        ? <Failed message={listError} onRetry={props.onRetry} />
        : revisions === null
        ? <LoadingSkeleton rows={3} />
        : revisions.length === 0
        ? (
          <div data-e2e="admin-blog-history-empty">
            <EmptyState headingLevel={3} title={t.t(`AdminBlogHistory.empty`)} />
          </div>
        )
        : <Versions {...props} revisions={revisions} />}
    </Modal>
  )
}

/** A refusal and its "Try again". */
function Failed({ message, onRetry }: { message: string; onRetry: () => void }): JSX.Element {
  const t = useAdminText()
  return (
    <div class="flex flex-col items-center gap-3" data-e2e="admin-blog-history-error">
      <ErrorState message={message} />
      <Button variant="secondary" onClick={onRetry}>
        {t.t(`AdminBlogEditor.retry`)}
      </Button>
    </div>
  )
}

/** The list and the picked version, stacked on a phone and side by side from `lg`. */
function Versions(
  props: BlogHistoryDialogProps & { revisions: readonly BlogRevisionSummary[] },
): JSX.Element {
  const t = useAdminText()
  const format = useFormat()
  const { selectedId, selected, selectedError } = props.history
  const someone = t.t(`AdminBlogHistory.someone`)
  return (
    <div class="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
      {/* Not chips: a scrolling list whose every version shows a title and who saved it when. */}
      <RadioGroup
        legend={t.t(`AdminBlogHistory.versions`)}
        name="blog-history-version"
        data-e2e="admin-blog-history-list"
        class="min-w-0 max-h-56 overflow-y-auto lg:max-h-[60vh] [&_label]:min-w-0 [&_label]:items-start [&_label]:rounded-md [&_label]:p-2 [&_label:hover]:bg-hover [&_label:has(:checked)]:bg-selected-soft [&_input]:mt-1"
        value={selectedId}
        onChange={props.onSelect}
        options={props.revisions.map((revision) => ({
          value: revision.id,
          label: (
            <span class="flex min-w-0 flex-col">
              <span class="truncate font-medium">
                <bdi>{revision.title}</bdi>
              </span>
              <span class="truncate text-sm text-muted">
                <When at={revision.savedAt} now={props.now.getTime()} />
                {` · `}
                <bdi>{revision.savedBy ?? someone}</bdi>
              </span>
            </span>
          ),
        }))}
      />
      <section
        aria-label={t.t(`AdminBlogHistory.shown`)}
        aria-busy={selected === null && selectedError === null}
        class="min-w-0"
        data-e2e="admin-blog-history-preview"
      >
        {selectedError !== null
          ? <Failed message={selectedError} onRetry={props.onRetry} />
          : selected === null
          ? <LoadingSkeleton rows={4} />
          : (
            <Stack gap="sm">
              <h3 class="text-lg font-semibold">
                <bdi>{selected.title}</bdi>
              </h3>
              <p class="text-sm text-muted" data-e2e="admin-blog-history-saved">
                {t.t(`AdminBlogHistory.savedBy`, {
                  date: format.exact(selected.savedAt),
                  name: selected.savedBy ?? someone,
                })}
              </p>
              <p>
                <bdi>{selected.description}</bdi>
              </p>
              <pre
                // A tab stop of its own, so the keyboard scrolls a long body.
                tabIndex={0}
                aria-label={t.t(`AdminBlogHistory.body`)}
                class="max-h-64 overflow-y-auto rounded-md border border-subtle bg-canvas p-3 font-mono text-sm whitespace-pre-wrap break-words lg:max-h-[50vh]"
                data-e2e="admin-blog-history-body"
              >{selected.bodyMd}</pre>
            </Stack>
          )}
      </section>
    </div>
  )
}
