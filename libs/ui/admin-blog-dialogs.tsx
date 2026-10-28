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
import type { AdminBlogEditorScreenProps } from "./admin-blog-editor.tsx"
import { Rich } from "@spy4x/preact-ui/i18n"
import { useAdminText } from "./i18n.ts"

/** A path inside a sentence: code, isolated, never machine-translated. */
function path(text: string): JSX.Element {
  return <bdi class="font-mono" translate={false}>{text}</bdi>
}

/**
 * The blog editor's dialogs (#396): publish or schedule, unschedule, unpublish, change the URL and
 * delete. Each one confirms; the ones that cannot be undone are drawn as danger.
 *
 * @module
 */

/** The open dialog, if any. */
export function Dialogs(props: AdminBlogEditorScreenProps): JSX.Element | null {
  const { dialog, post, value } = props
  const t = useAdminText()
  if (dialog === null) return null
  const title = (post?.title ?? value.title.trim()) || t.t(`AdminBlogDialogs.untitled`)
  const shared = {
    busy: props.dialogPending,
    onCancel: props.onCloseDialog,
    cancelLabel: t.t(`AdminBlogDialogs.cancel`),
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
          title={t.t(`AdminBlogDialogs.unscheduleTitle`, { title })}
          confirmLabel={t.t(`AdminBlogDialogs.unschedule`)}
          onConfirm={props.onUnschedule}
        >
          <DialogBody error={props.dialogError}>
            {t.t(`AdminBlogDialogs.unscheduleText`)}
          </DialogBody>
        </ConfirmDialog>
      )
    case `unpublish`:
      return (
        <ConfirmDialog
          {...shared}
          tone="danger"
          title={t.t(`AdminBlogDialogs.unpublishTitle`, { title })}
          confirmLabel={t.t(`AdminBlogDialogs.unpublish`)}
          onConfirm={props.onUnpublish}
        >
          <DialogBody error={props.dialogError}>
            {t.t(`AdminBlogDialogs.unpublishText`)}
          </DialogBody>
        </ConfirmDialog>
      )
    case `delete`:
      return (
        <ConfirmDialog
          {...shared}
          tone="danger"
          title={t.t(`AdminBlogDialogs.deleteTitle`, { title })}
          confirmLabel={t.t(`AdminBlogDialogs.deletePost`)}
          onConfirm={props.onDelete}
        >
          <DialogBody error={props.dialogError}>
            {t.t(`AdminBlogDialogs.deleteText`)}
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
  const t = useAdminText()
  const old = props.post?.slug ?? ``
  const [slug, setSlug] = useState(old)
  const trimmed = slug.trim()
  const problem = trimmed === ``
    ? t.t(`AdminBlogDialogs.addSlug`)
    : BLOG_SLUG_PATTERN.test(trimmed)
    ? null
    : t.t(`AdminBlogDialogs.slugRule`)
  const [tried, setTried] = useState(false)
  return (
    <ConfirmDialog
      busy={props.dialogPending}
      onCancel={props.onCloseDialog}
      cancelLabel={t.t(`AdminBlogDialogs.cancel`)}
      tone="danger"
      title={t.t(`AdminBlogDialogs.changeUrlTitle`)}
      confirmLabel={t.t(`AdminBlogDialogs.changeUrl`)}
      onConfirm={() => {
        setTried(true)
        if (problem === null && trimmed !== old) props.onChangeUrl(trimmed)
      }}
    >
      <Stack gap="md">
        <p>
          <Rich
            parts={t.parts(`AdminBlogDialogs.linksBreak`, { path: `/blog/${old}` })}
            tags={{ path }}
          />
        </p>
        <Field
          id="blog-new-slug"
          label={t.t(`AdminBlogDialogs.newSlug`)}
          hint={t.t(`AdminBlogDialogs.slugHint`)}
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
  const t = useAdminText()
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
  const atError = scheduling && tried && late ? t.t(`AdminBlogDialogs.futureTime`) : null
  const target = list ?? chosen?.list ?? null
  const sending = canEmail && emailing && target !== null
  const confirmLabel = scheduling
    ? t.t(`AdminBlogDialogs.schedule`)
    : sending && chosen
    ? t.t(`AdminBlogDialogs.publishAndEmail`, { count: chosen.confirmed })
    : t.t(`AdminBlogDialogs.publish`)
  const slug = post?.slug ?? value.slug.trim()
  return (
    <ConfirmDialog
      busy={props.dialogPending}
      onCancel={props.onCloseDialog}
      cancelLabel={t.t(`AdminBlogDialogs.cancel`)}
      title={t.t(scheduling ? `AdminBlogDialogs.scheduleTitle` : `AdminBlogDialogs.publishTitle`, {
        title: props.title,
      })}
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
            legend={t.t(`AdminBlogDialogs.when`)}
            name="blog-publish-when"
            data-e2e="admin-blog-when"
            options={[
              { value: `now`, label: t.t(`AdminBlogDialogs.now`) },
              { value: `schedule`, label: t.t(`AdminBlogDialogs.atATime`) },
            ]}
            value={when}
            onChange={(next) => setWhen(next === `schedule` ? `schedule` : `now`)}
          />
        )}
        {scheduling
          ? (
            <DateTimeField
              id="blog-publish-at"
              label={t.t(`AdminBlogDialogs.dateTime`)}
              value={at}
              onChange={setAt}
              timeZone={format.timeZone}
              min={now.toISOString()}
              hint={t.t(`AdminBlogDialogs.liveOnItsOwn`)}
              error={atError}
              required
            />
          )
          : (
            <p>
              <Rich
                parts={t.parts(`AdminBlogDialogs.goesLiveAt`, { path: `/blog/${slug}` })}
                tags={{ path }}
              />
            </p>
          )}
        {canEmail && chosen && (
          <Stack gap="sm">
            {lists.length > 1 && (
              <Field id="blog-publish-list" label={t.t(`AdminBlogDialogs.mailingList`)}>
                <Select
                  options={lists.map((entry) => ({ value: entry.list, label: entry.list }))}
                  value={chosen.list}
                  onChange={(e) =>
                    setList(e.currentTarget.value)}
                />
              </Field>
            )}
            <Checkbox
              checked={emailing}
              data-e2e="admin-blog-email"
              onChange={(e) => setEmailing(e.currentTarget.checked)}
            >
              {lists.length > 1
                ? (
                  <Rich
                    parts={t.parts(`AdminBlogDialogs.alsoEmailList`, {
                      count: chosen.confirmed,
                      list: chosen.list,
                    })}
                    tags={{ list: path }}
                  />
                )
                : t.t(`AdminBlogDialogs.alsoEmail`, { count: chosen.confirmed })}
            </Checkbox>
            {emailing && (
              <p class="text-sm text-muted" data-e2e="admin-blog-email-hint">
                {t.t(`AdminBlogDialogs.sentOnce`)}
              </p>
            )}
          </Stack>
        )}
        {props.dialogError && <ErrorState message={props.dialogError} />}
      </Stack>
    </ConfirmDialog>
  )
}
