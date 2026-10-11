import type { JSX } from "preact"
import { useRef, useState } from "preact/hooks"
import { Button } from "@spy4x/preact-ui/button"
import { badgeClasses } from "@spy4x/preact-ui/badge"
import { Field } from "@spy4x/preact-ui/field"
import { Input, Textarea } from "@spy4x/preact-ui/input"
import { Cluster, Stack } from "@spy4x/preact-ui/layout"
import {
  GROUP_COLORS,
  GROUP_DESCRIPTION_MAX,
  type GroupColor,
  type GroupDetails,
  GroupError,
  parseGroupDescription,
  parseGroupEmoji,
} from "@domain/groups"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { ScreenForm } from "./progressive.tsx"

/** What a colour is called on screen and to a screen reader. */
export const COLOR_TEXT: Record<GroupColor, string> = {
  red: "Red",
  orange: "Orange",
  green: "Green",
  blue: "Blue",
  purple: "Purple",
  gray: "Gray",
}

/** The group's colour and emoji, as the lists and the headers carry them. */
export interface GroupAppearance {
  color?: GroupColor | null
  emoji?: string | null
}

/**
 * A group's mark: its emoji on its colour, a plain swatch when it has a colour and no emoji, and
 * the emoji on gray when it has no colour. A group with neither has no mark, so an unstyled group
 * takes no room. The mark is decoration: the group's name always sits beside it.
 */
export function GroupMark(
  { color, emoji, size = "md", class: className }: GroupAppearance & {
    size?: "sm" | "md"
    class?: string
  },
): JSX.Element | null {
  if (!color && !emoji) return null
  const box = size === "sm" ? "size-5 text-xs" : "size-7 text-base"
  return (
    <span
      class={badgeClasses(
        color ?? "gray",
        "filled",
        `${box} shrink-0 justify-center rounded-md p-0 leading-none normal-case ${className ?? ""}`,
      )}
      aria-hidden="true"
      data-e2e="group-mark"
      data-color={color ?? undefined}
    >
      {emoji}
    </span>
  )
}

/** The group's name with its emoji in front, for a field that can show text only. */
export function groupLabel({ name, emoji }: { name: string; emoji?: string | null }): string {
  return emoji ? `${emoji} ${name}` : name
}

interface Draft {
  description: string
  color: GroupColor | null
  emoji: string
}

/**
 * The "Edit details" dialog's body: description, colour and emoji. Saving hands the values to
 * `onSave`; a rejection stays in the dialog under the field it is about, or under the form. The
 * emoji is checked here too, so a typo is told before a round trip.
 */
export function GroupDetailsForm(
  { initial, onSave, onCancel }: {
    initial: GroupDetails
    /** Saves the details. A rejection's message is shown in the form. */
    onSave: (details: GroupDetails) => Promise<void>
    onCancel: () => void
  },
): JSX.Element {
  const [draft, setDraft] = useState<Draft>({
    description: initial.description,
    color: initial.color,
    emoji: initial.emoji ?? "",
  })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [emojiError, setEmojiError] = useState<string | null>(null)
  const [descriptionError, setDescriptionError] = useState<string | null>(null)
  const descriptionBox = useRef<HTMLDivElement>(null)
  const emojiBox = useRef<HTMLDivElement>(null)

  async function submit(): Promise<void> {
    if (pending) return
    setError(null)
    setEmojiError(null)
    setDescriptionError(null)
    let description: string
    try {
      description = parseGroupDescription(draft.description)
    } catch (cause) {
      if (!(cause instanceof GroupError)) throw cause
      setDescriptionError(`Use at most ${GROUP_DESCRIPTION_MAX} characters.`)
      descriptionBox.current?.querySelector("textarea")?.focus()
      return
    }
    let emoji: string | null
    try {
      emoji = parseGroupEmoji(draft.emoji)
    } catch (cause) {
      if (!(cause instanceof GroupError)) throw cause
      setEmojiError("Use a single emoji, such as 🏕️, or leave it empty.")
      emojiBox.current?.querySelector("input")?.focus()
      return
    }
    setPending(true)
    try {
      await onSave({ description, color: draft.color, emoji })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the details.")
      setPending(false)
    }
  }

  return (
    <ScreenForm pending={pending} onSubmit={() => void submit()}>
      <Stack>
        <div ref={descriptionBox}>
          <Field
            id="group-description"
            label="Description"
            error={descriptionError}
            hint={`${Array.from(draft.description).length} of ${GROUP_DESCRIPTION_MAX} characters`}
          >
            <Textarea
              data-e2e="group-description"
              name="description"
              rows={3}
              placeholder="What is this group for?"
              value={draft.description}
              onInput={(e) => setDraft({ ...draft, description: e.currentTarget.value })}
            />
          </Field>
        </div>
        <ColorChoice value={draft.color} onChange={(color) => setDraft({ ...draft, color })} />
        <div ref={emojiBox}>
          <Field id="group-emoji" label="Emoji" error={emojiError}>
            <Input
              data-e2e="group-emoji"
              name="emoji"
              autocomplete="off"
              placeholder="🏕️"
              class="w-24"
              value={draft.emoji}
              onInput={(e) => setDraft({ ...draft, emoji: e.currentTarget.value })}
            />
          </Field>
        </div>
        <ErrorState focusOnAppear message={error} dataE2E="group-details-error" />
        <Cluster justify="end">
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          <Button type="submit" data-e2e="group-details-save" busy={pending} busyLabel="Saving...">
            Save
          </Button>
        </Cluster>
      </Stack>
    </ScreenForm>
  )
}

/**
 * The colour choice: one radio per palette name, drawn as its swatch, plus "None". They are real
 * radio buttons in one group, so the arrow keys move between them and a screen reader reads each
 * colour's name.
 */
function ColorChoice(
  { value, onChange }: { value: GroupColor | null; onChange: (color: GroupColor | null) => void },
): JSX.Element {
  const options: readonly (GroupColor | null)[] = [null, ...GROUP_COLORS]
  return (
    <fieldset data-e2e="group-color">
      <legend class="pc-label mb-2">Colour</legend>
      <div class="flex flex-wrap gap-2">
        {options.map((color) => (
          <label key={color ?? "none"} class="cursor-pointer">
            <input
              type="radio"
              name="color"
              value={color ?? ""}
              checked={value === color}
              class="peer sr-only"
              data-e2e={`group-color-${color ?? "none"}`}
              onChange={() => onChange(color)}
            />
            <span
              class="flex min-h-11 min-w-11 items-center justify-center rounded-md border border-subtle px-3 text-sm peer-checked:ring-2 peer-checked:ring-focus peer-checked:ring-offset-2 peer-checked:ring-offset-focus peer-focus-visible:ring-2 peer-focus-visible:ring-focus sm:min-h-9 sm:min-w-9"
              title={color ? COLOR_TEXT[color] : "No colour"}
            >
              {color
                ? (
                  <>
                    <GroupMark color={color} size="sm" />
                    <span class="sr-only">{COLOR_TEXT[color]}</span>
                  </>
                )
                : <span>None</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
