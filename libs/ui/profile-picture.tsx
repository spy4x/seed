import type { JSX } from "preact"
import { useRef, useState } from "preact/hooks"
import { Avatar } from "@spy4x/preact-ui/avatar"
import { Button } from "@spy4x/preact-ui/button"
import { ConfirmDialog } from "@spy4x/preact-ui/confirm-dialog"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { FileInput, type FileRejection } from "@spy4x/preact-ui/file-input"
import { Cluster } from "@spy4x/preact-ui/layout"
import { TOUCH_TARGET } from "@spy4x/preact-ui/page-header"
import { SettingRow } from "@spy4x/preact-ui/setting-row"
import { useFocusFallback } from "@spy4x/preact-ui/use-focus-after-removal"
import { formatBytes } from "@spy4x/platform/universal/format-number"
import { PICTURE_MAX_BYTES, PICTURE_TYPES } from "@domain/identity"
import { Rich } from "@spy4x/preact-ui/i18n"
import { type AppText, say } from "./app-text.ts"
import { useAppText } from "./i18n.ts"

/** The id of "Upload" or "Change", which the palette's "Change profile picture" presses. */
export const PICTURE_BUTTON_ID = "profile-picture-choose"

/**
 * The types the chooser offers; the browser and the API refuse any other. The extensions let a
 * HEIC photo through on a desktop browser that gives it no type.
 */
export const PICTURE_ACCEPT = [...PICTURE_TYPES, ".heic", ".heif"].join(",")

/**
 * The rule for the file, in English, as the search palette shows it until its lane of #275
 * translates it. The row says it in the person's language (`ProfilePicture.rule`).
 */
export const PICTURE_RULE = `JPEG, PNG, WebP or HEIC, up to ${formatBytes(PICTURE_MAX_BYTES)}`

/** What the "Profile picture" row takes. */
export interface PictureRowProps {
  /** The person's name, for the initials while there is no picture. */
  name: string
  /** The picture shown: the saved one, or the chosen one while it uploads. */
  src?: string
  /** A picture is saved, so the row offers "Change" and "Remove". */
  hasPicture: boolean
  /** The saved picture is still being prepared, or could not be used; `null` once shown. */
  state?: "preparing" | "refused" | null
  /** What is in flight: an upload, a removal, or nothing. */
  status: "idle" | "uploading" | "removing"
  /** The last refusal, under the list; `null` for none. */
  error: AppText | null
  /** Read out by the row's status region: "Profile picture saved." and the like. */
  announcement: AppText | null
  /** The person chose an image the browser accepts. */
  onChoose: (file: File) => void
  /** The person chose a file the browser refused: the wrong type or too large. */
  onReject: (rejection: FileRejection) => void
  /** The person confirmed the removal. */
  onRemove: () => void
}

/**
 * The Account section's "Profile picture" row (#228): the avatar, the rule for the file and
 * "Upload", or "Change" and "Remove". The button opens the chooser at once; the upload shows the
 * chosen image in place while it runs. "Remove" asks first. When "Change" gives way to "Upload"
 * after a removal, focus moves to it instead of falling to the page.
 */
export function PictureRow(props: PictureRowProps): JSX.Element {
  const { name, src, hasPicture, status, announcement, state = null } = props
  const t = useAppText()
  const hidden = (text: string) => <span class="sr-only">{text}</span>
  const note = state === "preparing"
    ? t.t(`ProfilePicture.preparing`)
    : state === "refused"
    ? t.t(`ProfilePicture.refused`)
    : null
  const [confirming, setConfirming] = useState(false)
  const removeButton = useRef<HTMLButtonElement>(null)
  const actions = useRef<HTMLDivElement>(null)
  useFocusFallback(
    removeButton,
    () => actions.current?.querySelector<HTMLElement>(`#${PICTURE_BUTTON_ID}`),
  )
  return (
    <SettingRow
      label={t.t(`ProfilePicture.label`)}
      dataE2E="profile-picture-row"
      value={
        <span class="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
          <Avatar name={name} src={src} size="lg" alt="" class="shrink-0" />
          <span class="flex flex-col gap-1">
            <span class="text-sm text-muted">
              {t.t(`ProfilePicture.rule`, { max: formatBytes(PICTURE_MAX_BYTES) })}
            </span>
            {
              /* The state is visible and read out; the store's announcements are read out only. */
            }
            <span
              role="status"
              class={note === null
                ? "sr-only"
                : state === "refused"
                ? "text-sm font-medium text-danger"
                : "text-sm font-medium"}
              data-e2e="profile-picture-status"
            >
              {note ?? (announcement && say(t, announcement))}
            </span>
          </span>
        </span>
      }
      action={
        <div ref={actions}>
          <Cluster gap="sm" justify="end">
            <FileInput
              id={PICTURE_BUTTON_ID}
              appearance="button"
              accept={PICTURE_ACCEPT}
              maxSize={PICTURE_MAX_BYTES}
              label={
                <Rich
                  parts={t.parts(
                    hasPicture ? `ProfilePicture.changeHidden` : `ProfilePicture.uploadHidden`,
                  )}
                  tags={{ hidden }}
                />
              }
              busy={status === "uploading"}
              busyLabel={t.t(`ProfilePicture.uploading`)}
              disabled={status === "removing"}
              onFiles={(files) => props.onChoose(files[0])}
              onReject={(rejections) => props.onReject(rejections[0])}
            />
            {hasPicture && status !== "uploading" && (
              <Button
                ref={removeButton}
                type="button"
                variant="ghost"
                class={TOUCH_TARGET}
                data-e2e="profile-picture-remove"
                busy={status === "removing"}
                busyLabel={t.t(`SignInMethods.removing`)}
                onClick={() => setConfirming(true)}
              >
                <Rich parts={t.parts(`ProfilePicture.removeHidden`)} tags={{ hidden }} />
              </Button>
            )}
            {confirming && (
              <ConfirmDialog
                title={t.t(`ProfilePicture.removeTitle`)}
                message={t.t(`ProfilePicture.removeText`)}
                confirmLabel={t.t(`ProfilePicture.removeButton`)}
                cancelLabel={t.t(`EmailScreen.cancel`)}
                tone="danger"
                dataE2E="profile-picture-remove-dialog"
                onConfirm={() => {
                  setConfirming(false)
                  props.onRemove()
                }}
                onCancel={() => setConfirming(false)}
              />
            )}
          </Cluster>
        </div>
      }
    />
  )
}

/** The row's last refusal, under the list. It takes focus when it appears. */
export function PictureErrorState({ error }: { error: AppText | null }): JSX.Element {
  const t = useAppText()
  return (
    <ErrorState
      message={error && say(t, error)}
      focusOnAppear
      dataE2E="profile-picture-error"
    />
  )
}
