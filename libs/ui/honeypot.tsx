/**
 * The honeypot of every form that mails an address nobody has confirmed yet: sign-up, the
 * sign-in code, forgot password and the newsletter. The field is `honeypotField()` from
 * `@spy4x/preact-ui/honeypot`, labelled in the page's language; the API refuses a body whose field
 * is missing or filled (`honeypotSchema` in `@domain/identity`), so each screen hands the field's
 * value to its app.
 *
 * @module
 */
import type { JSX } from "preact"
import { useRef } from "preact/hooks"
import { honeypotField } from "@spy4x/preact-ui/honeypot"
import { HONEYPOT_FIELD_NAME } from "@spy4x/platform/universal/honeypot"
import { useAppText } from "./i18n.ts"

/** The honeypot field, its off-screen label in the app's language. */
export function HoneypotField(): JSX.Element {
  const t = useAppText()
  return honeypotField(HONEYPOT_FIELD_NAME, t.t(`Honeypot.label`))
}

/** The honeypot field's value in a submitted form, `""` when it is empty. */
export function honeypotOf(data: FormData): string {
  const value = data.get(HONEYPOT_FIELD_NAME)
  return typeof value === `string` ? value : ``
}

/**
 * The honeypot of a form whose submit callback hands back no `FormData`, such as preact-system's
 * `AuthForm`: `field` renders it, and `value()` reads what it holds at submit time. Its box is
 * `display: contents`, so the off-screen field adds no gap to a flex column.
 */
export function useHoneypot(): { field: JSX.Element; value: () => string } {
  const box = useRef<HTMLDivElement>(null)
  return {
    field: (
      <div ref={box} class="contents">
        <HoneypotField />
      </div>
    ),
    value: () => box.current?.querySelector(`input`)?.value ?? ``,
  }
}
