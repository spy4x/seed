import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { createTranslator } from "@spy4x/platform/universal/i18n"
import type { ErrorReason } from "@domain/errors"
import { REALTIME_ERROR_CODES } from "@spy4x/realtime"
import errors from "@i18n/errors/en.json" with { type: "json" }
import errorsRu from "@i18n/errors/ru.json" with { type: "json" }
import { errorText, fieldText, fieldTexts, known } from "./message.ts"

const ENGLISH = createTranslator({ language: `en`, catalogs: [{ source: errors }] })
const RUSSIAN = createTranslator({
  language: `ru`,
  catalogs: [{ source: errors, translation: errorsRu }],
})

/**
 * Every reason an API refusal may carry. The type makes the list whole: a reason added to
 * `ErrorReason` and left out here fails `deno check`.
 */
const REASONS: Record<ErrorReason, true> = {
  ADDRESS_NOT_PROVEN: true,
  ALREADY_MEMBER: true,
  ALREADY_SUBSCRIBED: true,
  ATTACHMENT_NOT_FOUND: true,
  AUTH_REQUIRED: true,
  BILLING_DISABLED: true,
  CATEGORY_NOT_EMPTY: true,
  CATEGORY_NOT_FOUND: true,
  CATEGORY_REQUIRED: true,
  expired: true,
  FILE_CONTENT: true,
  FILE_MISSING: true,
  FILE_TOO_LARGE: true,
  FILE_TYPE: true,
  GROUP_NOT_FOUND: true,
  GROUP_SUBSCRIBED: true,
  GUEST_NEEDS_SIGN_IN_METHOD: true,
  ID_ALREADY_EXISTS: true,
  IDEMPOTENCY_IN_PROGRESS: true,
  IDEMPOTENCY_KEY_INVALID: true,
  IDEMPOTENCY_KEY_REUSED: true,
  IMPORT_REFUSED: true,
  INTERNAL_ERROR: true,
  invalid: true,
  INVALID_CURSOR: true,
  INVALID_REQUEST: true,
  INVITATION_ALREADY_USED: true,
  INVITATION_EXPIRED: true,
  INVITATION_NOT_FOUND: true,
  INVITATION_REVOKED: true,
  INVITATION_USED_UP: true,
  INVITATION_WRONG_ACCOUNT: true,
  ITEM_NOT_FOUND: true,
  LAST_GROUP: true,
  LAST_OWNER: true,
  limited: true,
  LINK_NOT_FOUND: true,
  MEMBER_NOT_FOUND: true,
  MFA_REQUIRED: true,
  NAME_MISMATCH: true,
  NEWSLETTER_OFF: true,
  NO_SUBSCRIPTION: true,
  NOT_DRAFT_OR_SCHEDULED: true,
  NOTE_FULL: true,
  NOTE_NOT_FOUND: true,
  NOTHING_TO_MOVE: true,
  NOTIFICATION_NOT_FOUND: true,
  NOT_PUBLISHED: true,
  "not-recognised": true,
  NOT_SCHEDULED: true,
  ORDER_STALE: true,
  PASSWORD_INVALID: true,
  PASSWORD_LOCKED: true,
  PHOTO_CONTENT: true,
  PHOTO_NOT_FOUND: true,
  PHOTO_TOO_LARGE: true,
  PHOTO_TYPE: true,
  PICTURE_NOT_FOUND: true,
  PLAN_FEATURE_MISSING: true,
  PLAN_LIMIT_REACHED: true,
  POST_NOT_FOUND: true,
  PROVIDER_ERROR: true,
  provider_refused: true,
  REQUEST_ORIGIN_INVALID: true,
  result_unknown: true,
  ROLE_INSUFFICIENT: true,
  SAME_GROUP: true,
  SEARCH_RATE_LIMITED: true,
  SEAT_PRICE_NOT_ACCEPTED: true,
  SIGN_IN_LINK_ASKED_ELSEWHERE: true,
  SLUG_LOCKED: true,
  TRANSLATION_INVALID: true,
  SLUG_TAKEN: true,
  SLUG_UNCHANGED: true,
  SOURCE_NOT_FOUND: true,
  SUBSCRIPTION_RENEWS: true,
  TAG_LIMIT_REACHED: true,
  TAG_NAME_TAKEN: true,
  TAG_NOT_FOUND: true,
  TOKEN_INVALID: true,
  TOKEN_NOT_FOUND: true,
  TOKEN_SCOPE: true,
  TOO_MANY: true,
  TOO_MANY_LINKS: true,
  TOO_MANY_TOKENS: true,
  TOO_SOON: true,
  TRACKING_OFF: true,
  UNKNOWN_PLAN: true,
  UPLOAD_BUDGET: true,
  UPLOAD_NOT_FOUND: true,
  UPLOADS_PENDING: true,
  USER_NOT_ACTIVE: true,
  validation: true,
  VERSION_CONFLICT: true,
}

describe(`errors`, () => {
  it(`every reason the API can send has a sentence in the errors catalog`, () => {
    const missing = Object.keys(REASONS).filter((reason) => !known(`Reason.${reason}`))
    expect(missing).toEqual([])
  })

  it(`a refusal says its reason in the person's language`, () => {
    const refusal = { code: `not_found`, reason: `GROUP_NOT_FOUND`, message: `Group not found` }
    expect(errorText(RUSSIAN, refusal)).toBe(`Такой группы нет, или вы в ней больше не состоите.`)
    expect(errorText(ENGLISH, refusal)).toBe(
      `This group does not exist, or you are no longer in it.`,
    )
  })

  it(`in English, a refusal with no known reason keeps the server's sentence`, () => {
    const unknown = { code: `conflict`, reason: `SOMETHING_NEW`, message: `A new refusal` }
    expect(errorText(ENGLISH, unknown)).toBe(`A new refusal`)
    const reasonless = { code: `bad_request`, message: `Enter a valid e-mail address` }
    expect(errorText(ENGLISH, reasonless)).toBe(`Enter a valid e-mail address`)
  })

  it(`in another language, a refusal with no known reason says its code, never the server's English`, () => {
    const reasonless = { code: `not_found`, message: `Group not found` }
    expect(errorText(RUSSIAN, reasonless)).toBe(`Этого нет, или у вас нет к этому доступа.`)
    const unknown = { code: `conflict`, reason: `SOMETHING_NEW`, message: `A new refusal` }
    expect(errorText(RUSSIAN, unknown)).toBe(
      `За это время здесь что-то изменилось. Обновите страницу и попробуйте ещё раз.`,
    )
    expect(errorText(RUSSIAN, { message: `Too Many Requests`, status: 429 })).toBe(
      `Слишком много попыток. Подождите немного и попробуйте ещё раз.`,
    )
  })

  it(`every protocol code has a sentence in the errors catalog`, () => {
    const missing = REALTIME_ERROR_CODES.filter((code) => !known(`Code.${code}`))
    expect(missing).toEqual([])
  })

  it(`a failure on the server's side says so in general words`, () => {
    expect(errorText(RUSSIAN, { code: `internal`, message: `Request failed` })).toBe(
      `У нас что-то пошло не так. Попробуйте ещё раз.`,
    )
    expect(errorText(RUSSIAN, { message: `Bad Gateway`, status: 502 })).toBe(
      `У нас что-то пошло не так. Попробуйте ещё раз.`,
    )
    expect(errorText(ENGLISH, { message: `Not found`, status: 404 })).toBe(`Not found`)
  })

  it(`a failed field says what to fix, before the refusal's reason`, () => {
    const refusal = {
      code: `bad_request`,
      reason: `validation`,
      message: `name must be at most 100 characters`,
      fields: { name: { code: `maxLength`, values: { rule: 100 } } },
    }
    expect(errorText(RUSSIAN, refusal)).toBe(`Не больше 100 символов.`)
    expect(fieldTexts(RUSSIAN, refusal.fields)).toEqual({ name: `Не больше 100 символов.` })
  })

  it(`a field's rule picks the plural form of the person's language`, () => {
    const atMost = (rule: number) => fieldText(RUSSIAN, { code: `maxLength`, values: { rule } })
    expect([atMost(1), atMost(3), atMost(5)]).toEqual([
      `Не больше 1 символа.`,
      `Не больше 3 символов.`,
      `Не больше 5 символов.`,
    ])
    expect(fieldText(ENGLISH, { code: `maxLength`, values: { rule: 1 } })).toBe(
      `Use at most 1 character.`,
    )
  })

  it(`a field that must not be empty asks to fill it in`, () => {
    expect(fieldText(ENGLISH, { code: `minLength`, values: { rule: 1 } })).toBe(`Fill this in.`)
    expect(fieldText(ENGLISH, { code: `required` })).toBe(`Fill this in.`)
  })

  it(`an exclusive bound and an unknown field code each read right`, () => {
    expect(fieldText(ENGLISH, { code: `min`, values: { rule: 0, exclusive: true } })).toBe(
      `Use more than 0.`,
    )
    expect(fieldText(ENGLISH, { code: `min`, values: { rule: 0 } })).toBe(`Use 0 or more.`)
    expect(fieldText(RUSSIAN, { code: `somethingNew` })).toBe(`Это значение не подходит.`)
  })

  it(`a server's sentence is never read as a catalog key`, () => {
    const refusal = { code: `bad_request`, message: `Field.required` }
    expect(errorText(ENGLISH, refusal)).toBe(`Field.required`)
    expect(errorText(ENGLISH, { ...refusal, reason: `__proto__` })).toBe(`Field.required`)
  })
})
