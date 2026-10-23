import type { ComponentChildren, JSX } from "preact"
import { useState } from "preact/hooks"
import { Checkbox } from "@spy4x/preact-ui/checkbox"
import { ConfirmDialog } from "@spy4x/preact-ui/confirm-dialog"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { useFormat } from "@spy4x/preact-ui/format"
import { DateTimeField } from "@spy4x/preact-ui/date-time-field"
import { Input, Select } from "@spy4x/preact-ui/input"
import { Stack } from "@spy4x/preact-ui/layout"
import { RadioGroup } from "@spy4x/preact-ui/radio"
import { BLOG_SLUG_MAX_LENGTH, BLOG_SLUG_PATTERN } from "@domain/blog"
import { type AdminBlogEditorScreenProps, NUMBER } from "./admin-blog-editor.tsx"

/**
 * The blog editor's dialogs (#396): publish or schedule, unschedule, unpublish, change the URL and
 * delete. Each one confirms; the ones that cannot be undone are drawn as danger.
 *
 * @module
 */

/** The open dialog, if any. */
export function Dialogs(props: AdminBlogEditorScreenProps): JSX.Element | null {
  const { dialog, post, value } = props
  if (dialog === null) return null
  const title = (post?.title ?? value.title.trim()) || `Untitled`
  const shared = {
    busy: props.dialogPending,
    onCancel: props.onCloseDialog,
    cancelLabel: `Cancel`,
  }
  switch (dialog) {
    case `publish`:
    case `publish-now`:
    case `reschedule`:
      return <PublishDialog {...props} title={title} />
    case `unschedule`:
      return (
        <ConfirmDialog
          {...shared}
          title={`Unschedule "${title}"?`}
          confirmLabel="Unschedule"
          onConfirm={props.onUnschedule}
        >
          <DialogBody error={props.dialogError}>
            It goes back to drafts. A newsletter send you chose is cancelled too.
          </DialogBody>
        </ConfirmDialog>
      )
    case `unpublish`:
      return (
        <ConfirmDialog
          {...shared}
          tone="danger"
          title={`Unpublish "${title}"?`}
          confirmLabel="Unpublish"
          onConfirm={props.onUnpublish}
        >
          <DialogBody error={props.dialogError}>
            It comes off the website and the RSS feed, and its address stops working. An email
            already sent stays sent.
          </DialogBody>
        </ConfirmDialog>
      )
    case `delete`:
      return (
        <ConfirmDialog
          {...shared}
          tone="danger"
          title={`Delete "${title}"?`}
          confirmLabel="Delete post"
          onConfirm={props.onDelete}
        >
          <DialogBody error={props.dialogError}>
            The post and its text are deleted for good. This cannot be undone.
          </DialogBody>
        </ConfirmDialog>
      )
    case `change-url`:
      return <ChangeUrlDialog {...props} />
  }
}

/** A dialog's sentence, and the API's refusal under it. */
function DialogBody(
  { error, children }: { error: string | null; children: ComponentChildren },
): JSX.Element {
  return (
    <Stack gap="md">
      <p>{children}</p>
      {error && <ErrorState message={error} />}
    </Stack>
  )
}

/** The new address of a published post, with the warning that old links break. */
function ChangeUrlDialog(props: AdminBlogEditorScreenProps): JSX.Element {
  const old = props.post?.slug ?? ``
  const [slug, setSlug] = useState(old)
  const trimmed = slug.trim()
  const problem = trimmed === ``
    ? `Add a slug.`
    : BLOG_SLUG_PATTERN.test(trimmed)
    ? null
    : `Use lowercase letters, digits and hyphens only.`
  const [tried, setTried] = useState(false)
  return (
    <ConfirmDialog
      busy={props.dialogPending}
      onCancel={props.onCloseDialog}
      cancelLabel="Cancel"
      tone="danger"
      title="Change this post's URL?"
      confirmLabel="Change URL"
      onConfirm={() => {
        setTried(true)
        if (problem === null && trimmed !== old) props.onChangeUrl(trimmed)
      }}
    >
      <Stack gap="md">
        <p>Links to /blog/{old} stop working.</p>
        <Field
          id="blog-new-slug"
          label="New slug"
          hint="Lowercase letters, digits and hyphens."
          error={tried ? problem : null}
          required
        >
          <Input
            class="font-mono text-sm"
            data-e2e="admin-blog-new-slug"
            maxLength={BLOG_SLUG_MAX_LENGTH}
            autocomplete="off"
            spellcheck={false}
            value={slug}
            onInput={(e) => setSlug(e.currentTarget.value)}
          />
        </Field>
        {props.dialogError && <ErrorState message={props.dialogError} />}
      </Stack>
    </ConfirmDialog>
  )
}

/** An hour from `now`, on the minute: where the schedule field starts. */
function inAnHour(now: Date): string {
  const at = new Date(now.getTime() + 3_600_000)
  at.setUTCSeconds(0, 0)
  return at.toISOString()
}

/**
 * Publish a draft now or at a time, publish a scheduled post now, or move its time. Emailing the
 * post is an unchecked box that names how many people get it, offered only while the newsletter is
 * on and the post was never emailed; the button then says so too.
 */
function PublishDialog(props: AdminBlogEditorScreenProps & { title: string }): JSX.Element {
  const { dialog, post, value, newsletter, now } = props
  const format = useFormat()
  const [when, setWhen] = useState<`now` | `schedule`>(dialog === `reschedule` ? `schedule` : `now`)
  const [at, setAt] = useState<string | null>(post?.publishAt ?? inAnHour(now))
  const lists = newsletter?.enabled ? newsletter.lists : []
  const sent = post?.newsletterSentAt != null
  // The list the post already carries stays chosen: the API reads a missing list as "no email",
  // so publishing now or moving the time sends it again, also before the lists have loaded.
  const [emailing, setEmailing] = useState(post?.newsletterList != null)
  const [list, setList] = useState(post?.newsletterList ?? lists[0]?.list ?? null)
  const [tried, setTried] = useState(false)
  const chosen = lists.find((entry) => entry.list === (list ?? lists[0]?.list))
  const canEmail = !sent && (chosen !== undefined || post?.newsletterList != null)
  const scheduling = when === `schedule`
  const late = at === null || new Date(at).getTime() <= now.getTime()
  const atError = scheduling && tried && late ? `Pick a time in the future.` : null
  const target = list ?? chosen?.list ?? null
  const sending = canEmail && emailing && target !== null
  const confirmLabel = scheduling
    ? `Schedule`
    : sending && chosen
    ? `Publish and email ${NUMBER.format(chosen.confirmed)}`
    : `Publish`
  const slug = post?.slug ?? value.slug.trim()
  return (
    <ConfirmDialog
      busy={props.dialogPending}
      onCancel={props.onCloseDialog}
      cancelLabel="Cancel"
      title={scheduling ? `Schedule "${props.title}"` : `Publish "${props.title}"?`}
      confirmLabel={confirmLabel}
      onConfirm={() => {
        setTried(true)
        if (scheduling && late) return
        props.onPublish({ at: scheduling ? at : null, list: sending ? target : null })
      }}
    >
      <Stack gap="md">
        {dialog === `publish` && (
          <RadioGroup
            legend="When"
            name="blog-publish-when"
            data-e2e="admin-blog-when"
            options={[
              { value: `now`, label: `Now` },
              { value: `schedule`, label: `At a time` },
            ]}
            value={when}
            onChange={(next) => setWhen(next === `schedule` ? `schedule` : `now`)}
          />
        )}
        {scheduling
          ? (
            <DateTimeField
              id="blog-publish-at"
              label="Date and time"
              value={at}
              onChange={setAt}
              timeZone={format.timeZone}
              min={now.toISOString()}
              hint="It goes live on its own at that time."
              error={atError}
              required
            />
          )
          : <p>It goes live at /blog/{slug} and joins the RSS feed and sitemap.</p>}
        {canEmail && chosen && (
          <Stack gap="sm">
            {lists.length > 1 && (
              <Field id="blog-publish-list" label="Mailing list">
                <Select
                  options={lists.map((entry) => ({ value: entry.list, label: entry.list }))}
                  value={chosen.list}
                  onChange={(e) => setList(e.currentTarget.value)}
                />
              </Field>
            )}
            <Checkbox
              checked={emailing}
              data-e2e="admin-blog-email"
              onChange={(e) => setEmailing(e.currentTarget.checked)}
            >
              Also email this post to {NUMBER.format(chosen.confirmed)} confirmed subscribers
              {lists.length > 1 ? ` of ${chosen.list}` : ``}
            </Checkbox>
            {emailing && (
              <p class="text-sm text-muted" data-e2e="admin-blog-email-hint">
                Sent once, when the post goes live. It cannot be unsent.
              </p>
            )}
          </Stack>
        )}
        {props.dialogError && <ErrorState message={props.dialogError} />}
      </Stack>
    </ConfirmDialog>
  )
}
