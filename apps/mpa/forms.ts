/** The largest form any page accepts, far above the newsletter forms' address and token. */
export const MAX_FORM_BYTES = 256 * 1024

/** What every page passes to `readFormBody`: a form over the cap is answered 413, a stall 408. */
export const FORM_LIMITS = { maxBytes: MAX_FORM_BYTES } as const

/** A text field's value, or `""` when the form has none. */
function field(form: FormData, name: string): string {
  const value = form.get(name)
  return typeof value === "string" ? value : ""
}

/** The page's language a form posts, left out when it posts none. */
function language(form: FormData): { language?: string } {
  const value = field(form, "language")
  return value === "" ? {} : { language: value }
}

/**
 * Each form translated into the JSON body of its API call. The MPA only picks: every form already
 * posts the API's field names, and the API's schemas validate every value, so no rule lives here.
 */
export const API_BODIES = {
  subscribe: (form: FormData) => ({
    email: field(form, "email"),
    list: field(form, "list"),
    ...language(form),
  }),
  /** The list and token a subscription link carries, for its confirm or its unsubscribe. */
  subscriptionToken: (form: FormData) => ({
    list: field(form, "list"),
    token: field(form, "token"),
  }),
  /** A confirm: the link's list and token, and the page's language. */
  subscriptionConfirm: (form: FormData) => ({
    list: field(form, "list"),
    token: field(form, "token"),
    ...language(form),
  }),
} as const
