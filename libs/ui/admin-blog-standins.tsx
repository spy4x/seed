/**
 * STAND-INS, TO BE DELETED: `ListField`, `DateTimeField`, `Prose` and `TldrBox` with the props of
 * spy4x/preact-components#1002, which ships them in `@spy4x/preact-ui` 10.8.0. Until that release
 * is on JSR the blog editor imports them from here; the swap is one import line per component in
 * `admin-blog-editor.tsx` and the deletion of this file.
 *
 * @module
 */
import type { ComponentChildren, JSX } from "preact"
import { Button } from "@spy4x/preact-ui/button"
import { Field } from "@spy4x/preact-ui/field"
import { Input } from "@spy4x/preact-ui/input"
import { hhmmInTz, isoDateInTz, zonedDateTime } from "@spy4x/time/tz"

/** STAND-IN for `@spy4x/preact-ui/list-field`. */
export function ListField(props: {
  id: string
  label: ComponentChildren
  value: readonly string[]
  onChange: (value: string[]) => void
  max?: number
  maxLength?: number
  hint?: ComponentChildren
  error?: string | null
  disabled?: boolean
  labels?: { item?: (n: number) => string; remove?: (n: number) => string; add?: string }
}): JSX.Element {
  const { id, value, onChange, max = Infinity } = props
  return (
    <fieldset class="flex flex-col gap-2" id={id}>
      <legend class="text-sm font-medium">{props.label}</legend>
      {props.hint && <p class="text-sm text-muted">{props.hint}</p>}
      {value.map((item, index) => (
        <div class="flex items-center gap-2" key={index}>
          <Input
            aria-label={props.labels?.item?.(index + 1) ?? `Item ${index + 1}`}
            value={item}
            maxLength={props.maxLength}
            disabled={props.disabled}
            onInput={(e) =>
              onChange(value.map((old, at) => at === index ? e.currentTarget.value : old))}
          />
          <Button
            variant="ghost"
            size="sm"
            aria-label={props.labels?.remove?.(index + 1) ?? `Remove item ${index + 1}`}
            onClick={() => onChange(value.filter((_, at) => at !== index))}
          >
            ✕
          </Button>
        </div>
      ))}
      {value.length < max && (
        <div>
          <Button variant="ghost" size="sm" onClick={() => onChange([...value, ``])}>
            {props.labels?.add ?? `Add item`}
          </Button>
        </div>
      )}
      {props.error && <p class="text-sm text-danger">{props.error}</p>}
    </fieldset>
  )
}

/** The wall clock `instant` shows in `zone`, as a `datetime-local` value. */
function wallClock(instant: Date, zone: string): string {
  return `${isoDateInTz(instant, zone)}T${hhmmInTz(instant, zone)}`
}

/** The instant whose wall clock in `zone` reads `local`. */
function fromWallClock(local: string, zone: string): Date {
  const [date, time] = local.split(`T`)
  return zonedDateTime(date, time, zone)
}

/** STAND-IN for `@spy4x/preact-ui/date-time-field`. */
export function DateTimeField(props: {
  id: string
  label: ComponentChildren
  value: string | null
  onChange: (value: string | null) => void
  timeZone: string
  min?: string
  hint?: ComponentChildren
  error?: string | null
  required?: boolean
  labels?: { zone?: (zone: string) => string }
}): JSX.Element {
  const { id, value, timeZone } = props
  return (
    <Field
      id={id}
      label={props.label}
      error={props.error}
      required={props.required}
      hint={
        <>
          {props.labels?.zone?.(timeZone) ?? `Time zone: ${timeZone}`}
          {props.hint && <span class="block">{props.hint}</span>}
        </>
      }
    >
      <Input
        type="datetime-local"
        value={value ? wallClock(new Date(value), timeZone) : ``}
        min={props.min ? wallClock(new Date(props.min), timeZone) : undefined}
        onInput={(e) => {
          const local = e.currentTarget.value
          props.onChange(local ? fromWallClock(local, timeZone).toISOString() : null)
        }}
      />
    </Field>
  )
}

/** STAND-IN for `@spy4x/preact-ui/prose`: the HTML must already be safe (rendered by the API). */
export function Prose(props: { html: string; class?: string }): JSX.Element {
  return (
    <div
      class={`pc-prose ${props.class ?? ``}`}
      data-prose=""
      dangerouslySetInnerHTML={{ __html: props.html }}
    />
  )
}

/** STAND-IN for `@spy4x/preact-ui/tldr-box`. */
export function TldrBox(
  props: { items: readonly ComponentChildren[]; headingLevel?: 2 | 3 | 4; class?: string },
): JSX.Element | null {
  if (props.items.length === 0) return null
  return (
    <section class={`rounded-primary border border-subtle px-4 py-4 sm:px-6 ${props.class ?? ``}`}>
      <h3 class="text-base font-semibold text-foreground">In short</h3>
      <ul class="mt-2 list-disc pl-6 text-base leading-7 text-foreground marker:text-muted">
        {props.items.map((item, index) => <li key={index}>{item}</li>)}
      </ul>
    </section>
  )
}
