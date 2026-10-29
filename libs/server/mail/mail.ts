/**
 * How the template sends mail: which transport runs where, the one HTML wrapper every mail uses,
 * and the mails themselves.
 *
 * - **Development** (`ENV=dev`) uses the console sender of `@spy4x/email`: the mail goes to the
 *   worker's log, and to the `dev_mail` table, where the e2e specs read it. SMTP settings are
 *   ignored there.
 * - **Production** uses SMTP when every `SMTP_*` key is set. With any of them missing, mail is
 *   off: nothing is sent and the caller logs {@link mailOffWarning} once at start-up. The console
 *   sender never runs in production, since it prints the body, a reset link included, and
 *   container logs are shipped.
 *
 * `@spy4x/email` reads no environment by design, so the template maps its own variables here.
 *
 * @module
 */

import { createConsoleSender, type EmailSender } from "@spy4x/email/sender"
import { createSmtpSender, type SmtpOptions } from "@spy4x/email/smtp"
import { DEFAULT_HTML_SHELL_THEME, emailButton, escapeHtml, htmlWrap } from "@spy4x/email/html"
import type { EmailMessage } from "@spy4x/email/message"
import type { Sql } from "@spy4x/server/db"
import { type Catalog, createTranslator, type Translator } from "@spy4x/platform/universal/i18n"
import { createFormatters, type Formatters, type HourCycle } from "@spy4x/time/format"
import { BillingNoticeKind, findPlan, FREE_PLAN_ID, PRO_PLAN_ID } from "@domain/billing"
import { GroupRole } from "@domain/groups"
import type { Language } from "@domain/identity"
import appEn from "@i18n/app/en.json" with { type: "json" }
import appRu from "@i18n/app/ru.json" with { type: "json" }
import appEs from "@i18n/app/es.json" with { type: "json" }
import appDe from "@i18n/app/de.json" with { type: "json" }
import appPtBR from "@i18n/app/pt-BR.json" with { type: "json" }
import appAr from "@i18n/app/ar.json" with { type: "json" }
import mailEn from "@i18n/mail/en.json" with { type: "json" }
import mailRu from "@i18n/mail/ru.json" with { type: "json" }
import mailEs from "@i18n/mail/es.json" with { type: "json" }
import mailDe from "@i18n/mail/de.json" with { type: "json" }
import mailPtBR from "@i18n/mail/pt-BR.json" with { type: "json" }
import mailAr from "@i18n/mail/ar.json" with { type: "json" }

/** The variables SMTP needs. All five must be set for production to send mail. */
export const SMTP_KEYS = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"] as const

/** Which transport sends the mail. */
export enum MailTransport {
  /** Development: the log and the `dev_mail` table. */
  Console = 1,
  /** Production with every `SMTP_*` key set. */
  Smtp = 2,
  /** Production with an `SMTP_*` key missing: nothing is sent. */
  Off = 3,
}

/** The transport the environment picks, and what it needs. */
export type MailSetup =
  | { transport: MailTransport.Console }
  | { transport: MailTransport.Smtp; smtp: SmtpOptions }
  | { transport: MailTransport.Off; missing: string[] }

/**
 * Picks the transport from the environment. Only `ENV=dev` gets the console sender; any other
 * value is treated as production. A port that is not a whole number from 1 to 65535 counts as
 * missing. Never throws: production without SMTP must still start.
 */
export function readMailSetup(env: { get(name: string): string | undefined }): MailSetup {
  if (env.get("ENV") === "dev") return { transport: MailTransport.Console }
  const value = (key: (typeof SMTP_KEYS)[number]) => env.get(key)?.trim() ?? ""
  const port = Number(value("SMTP_PORT"))
  const missing = SMTP_KEYS.filter((key) =>
    key === "SMTP_PORT" ? !(Number.isInteger(port) && port >= 1 && port <= 65535) : !value(key)
  )
  if (missing.length > 0) return { transport: MailTransport.Off, missing }
  return {
    transport: MailTransport.Smtp,
    smtp: {
      host: value("SMTP_HOST"),
      port,
      user: value("SMTP_USER"),
      pass: value("SMTP_PASS"),
      from: value("SMTP_FROM"),
    },
  }
}

/** The start-up warning for a setup that sends nothing: it names the keys, never a value. */
export function mailOffWarning(setup: MailSetup): string | null {
  if (setup.transport !== MailTransport.Off) return null
  return `warning: mail is off, so password reset links and e-mail codes are not sent. Set ${
    setup.missing.join(", ")
  } to send them.`
}

/**
 * The sender for `setup`, or `null` when mail is off. In development every mail is also written to
 * `dev_mail` through `sql`, before it is logged.
 */
export function createMailSender(setup: MailSetup, sql: Sql): EmailSender | null {
  if (setup.transport === MailTransport.Off) return null
  if (setup.transport === MailTransport.Smtp) return createSmtpSender(setup.smtp)
  const logged = createConsoleSender()
  return {
    async send(message) {
      const to = Array.isArray(message.to) ? message.to : [message.to]
      for (const address of to) {
        await sql`
          INSERT INTO dev_mail (to_address, subject, text_body)
          VALUES (${address}, ${message.subject}, ${message.text ?? ""})
        `
      }
      return await logged.send(message)
    },
  }
}

/** Where a mail comes from: the app's host name, which also links to the app. */
export interface MailBrand {
  /** The app's address, such as `https://app.example.com`. */
  webAppUrl: string
}

/**
 * Who reads a mail (#277): the language it is written in, and the region format, zone and clock
 * its dates use. {@link readMailReader} reads it for an account.
 */
export interface MailReader {
  language: Language
  /** The region format, a BCP 47 tag such as `de-DE`. */
  locale: string
  /** An IANA zone; `null` when unknown, and a time then says it is in UTC. */
  timeZone: string | null
  /** The clock; `null` lets the region format decide. */
  hourCycle: HourCycle | null
}

/** A reader nothing is known of: English, in UTC. */
export const ENGLISH_READER: MailReader = Object.freeze({
  language: `en`,
  locale: `en`,
  timeZone: null,
  hourCycle: null,
})

/**
 * Both catalogs a mail reads, per language: its own words (`mail`) and the names the app already
 * translates (`app`: roles and plans), so a role reads the same in the mail and on the screen.
 */
const CATALOGS: Record<Language, { app?: Catalog; mail?: Catalog }> = {
  en: {},
  ru: { app: appRu, mail: mailRu },
  es: { app: appEs, mail: mailEs },
  de: { app: appDe, mail: mailDe },
  "pt-BR": { app: appPtBR, mail: mailPtBR },
  ar: { app: appAr, mail: mailAr },
}
const translators = new Map<Language, Translator<string>>()

/** The mail's words in `language`, made on first use. */
export function translatorFor(language: Language): Translator<string> {
  let translator = translators.get(language)
  if (!translator) {
    const { app, mail } = CATALOGS[language] ?? CATALOGS.en
    translator = createTranslator({
      language: CATALOGS[language] ? language : `en`,
      catalogs: [{ source: appEn, translation: app }, { source: mailEn, translation: mail }],
    })
    translators.set(language, translator)
  }
  return translator
}

/** What a builder writes with: the reader's words and the reader's date formats. */
interface Writer {
  t: Translator<string>
  format: Formatters
  /** A moment with its time of day, in the reader's zone; in UTC, said so, when it is unknown. */
  moment(at: Date): string
  /** A day in the reader's zone. */
  day(at: Date): string
}

function writerFor(reader: MailReader): Writer {
  const t = translatorFor(reader.language)
  // `device` keeps the host's own locale and zone out of the mail: the reader's or UTC, never ours.
  const format = createFormatters(
    { locale: reader.locale, timeZone: reader.timeZone, hourCycle: reader.hourCycle },
    { device: { locale: reader.language, timeZone: `UTC` } },
  )
  return {
    t,
    format,
    moment: (at) =>
      reader.timeZone ? format.dateTime(at, `long`) : `${format.dateTime(at, `long`)} UTC`,
    day: (at) => format.date(at, `long`),
  }
}

/**
 * A value a person typed (a name, a group), on one line: every line break and other control
 * character becomes a space. A subject is a mail header, and a line break in one would start a
 * header of its own.
 */
export function oneLine(value: string): string {
  return value.replace(/[\p{Cc}\u2028\u2029]+/gu, ` `).trim()
}

/** The four bidirectional isolate marks, LRI, RLI, FSI and PDI. */
const ISOLATE_MARKS = /[\u2066-\u2069]/g

/**
 * A value a person typed (a name, a group), on one line and isolated between FSI and PDI, so its
 * own direction cannot reorder the sentence around it: "Team (EU)!" inside Arabic keeps its
 * bracket and "!" where they were typed. The text part keeps the marks; the HTML part draws them
 * as `<bdi>`; the subject drops them. Isolate marks inside the value are removed, so it cannot
 * close its isolation early.
 */
export function isolate(value: string): string {
  return `\u2068${oneLine(value).replace(ISOLATE_MARKS, ``)}\u2069`
}

/** An isolated value in escaped HTML, drawn as `<bdi>`. A stray mark stays an invisible mark. */
function isolatesAsBdi(html: string): string {
  return html.replace(/\u2068([^\u2068\u2069]*)\u2069/g, `<bdi>$1</bdi>`)
}

/**
 * A full stop the sentence puts right after a value that already ends in one, such as the Russian
 * long date's «г.», is dropped, so the reader sees one stop. A closing tag or an isolation's end
 * between the two is kept; an ellipsis is left alone.
 */
function oneStop(text: string): string {
  return text.replace(/(?<=\p{L}\.)((?:<\/\w+>|\u2069)*)\.(?!\.)/gu, `$1`)
}

/** One block of a mail's body, drawn the same way in the text part and the HTML part. */
export type Block =
  /** A paragraph from the catalog; a `<strong>` span in it is drawn bold in the HTML. */
  | { key: string; values?: Record<string, string | number> }
  /** A link the template made: plain in the text, a link in the HTML. */
  | { link: string; label: string }
  /** The call to action: plain in the text, a button in the HTML. */
  | { button: string; label: string }
  /** A code to type: alone on its line, large in the HTML. */
  | { code: string }

/**
 * The tags a catalog message may use, and the element each draws. Any other is plain text. The
 * HTML part also draws an isolated value (see {@link isolate}) as `<bdi>`.
 */
const TAGS: Record<string, string> = { strong: `strong` }

/**
 * A catalog message as HTML. Every part is escaped, the catalog's own words included, so neither
 * a value nor a translation can add markup: the only elements are the ones {@link TAGS} names,
 * and `<bdi>` around an isolated value. Exported for its tests.
 */
export function messageHtml(
  t: Translator<string>,
  key: string,
  values?: Record<string, string | number>,
): string {
  return oneStop(isolatesAsBdi(
    t.parts(key, values).map((part) => {
      if (typeof part === `string`) return escapeHtml(part)
      const element = Object.hasOwn(TAGS, part.tag) ? TAGS[part.tag] : null
      return element ? `<${element}>${escapeHtml(part.text)}</${element}>` : escapeHtml(part.text)
    }).join(``),
  ))
}

/**
 * A whole mail in `t`'s language: the subject on one line without isolate marks, which some mail
 * clients would draw as boxes, the text part, and the HTML part in the shared shell, with `lang`
 * and `dir` so Arabic reads right to left. Exported for its tests.
 */
export function compose(
  brand: MailBrand,
  t: Translator<string>,
  to: string,
  subject: string,
  blocks: readonly Block[],
): EmailMessage {
  const text = blocks.map((block) =>
    `key` in block
      ? oneStop(t.t(block.key, block.values))
      : `code` in block
      ? block.code
      : `link` in block
      ? block.link
      : block.button
  )
  const html = blocks.map((block) => {
    if (`key` in block) return `<p>${messageHtml(t, block.key, block.values)}</p>`
    if (`code` in block) {
      // A code reads left to right in every language: a `-` at its edge stays where it is typed.
      return `<p style="font-size:24px;font-weight:600;letter-spacing:2px"><span dir="ltr">${
        escapeHtml(block.code)
      }</span></p>`
    }
    if (`link` in block) {
      return `<p><a href="${escapeHtml(block.link)}">${escapeHtml(block.label)}</a></p>`
    }
    return emailButton({
      href: block.button,
      label: block.label,
      background: DEFAULT_HTML_SHELL_THEME.linkColor,
      color: `#ffffff`,
    })
  })
  return {
    to,
    subject: oneStop(oneLine(subject).replace(ISOLATE_MARKS, ``)),
    text: `${text.join(`\n\n`)}\n`,
    html: mailHtml(brand, html.join(`\n`), t),
  }
}

/**
 * The one HTML wrapper every mail uses. `body` must already be escaped. `t` names the language,
 * its direction and the signature's words; without it the shell is English.
 */
export function mailHtml(brand: MailBrand, body: string, t = translatorFor(`en`)): string {
  return htmlWrap({
    body,
    brand: new URL(brand.webAppUrl).host,
    brandUrl: brand.webAppUrl,
    signaturePrefix: t.t(`Mail.sentBy`),
    lang: t.language,
    dir: t.dir,
  })
}

/** The app's host name, as every mail names the app. */
function hostOf(brand: MailBrand): string {
  return new URL(brand.webAppUrl).host
}

/** The mail that carries a password reset link. */
export function passwordResetMail(
  brand: MailBrand,
  { to, link, validMinutes, reader }: {
    to: string
    link: string
    validMinutes: number
    reader: MailReader
  },
): EmailMessage {
  const w = writerFor(reader)
  return compose(brand, w.t, to, w.t.t(`PasswordResetMail.subject`), [
    { key: `PasswordResetMail.asked`, values: { host: hostOf(brand) } },
    { key: `PasswordResetMail.open`, values: { count: validMinutes } },
    { link, label: w.t.t(`PasswordResetMail.button`) },
    { key: `PasswordResetMail.once` },
    { key: `PasswordResetMail.ignore` },
  ])
}

/**
 * The mail that carries a sign-in link (#391). The same mail whether or not an account uses the
 * address: the link signs in to the account, or creates one. It says that opening the link does
 * nothing until the person presses Continue, so the extra press reads as expected.
 */
export function signInLinkMail(
  brand: MailBrand,
  { to, link, validMinutes, at, reader }: {
    to: string
    link: string
    validMinutes: number
    at: Date
    reader: MailReader
  },
): EmailMessage {
  const w = writerFor(reader)
  const host = hostOf(brand)
  return compose(brand, w.t, to, w.t.t(`SignInLinkMail.subject`, { host }), [
    { key: `SignInLinkMail.asked`, values: { host, when: w.moment(at) } },
    { key: `SignInLinkMail.open`, values: { count: validMinutes } },
    { button: link, label: w.t.t(`SignInLinkMail.button`, { host }) },
    { key: `SignInLinkMail.once` },
    { key: `SignInLinkMail.ignore` },
  ])
}

/**
 * The mail that carries a code proving the address it is sent to. The code is what the person
 * types; the mail holds no link, so nothing in it signs anybody in.
 */
export function emailCodeMail(
  brand: MailBrand,
  { to, code, validMinutes, reader }: {
    to: string
    code: string
    validMinutes: number
    reader: MailReader
  },
): EmailMessage {
  const w = writerFor(reader)
  return compose(brand, w.t, to, w.t.t(`EmailCodeMail.subject`), [
    { key: `EmailCodeMail.asked`, values: { host: hostOf(brand) } },
    { code },
    { key: `EmailCodeMail.valid`, values: { count: validMinutes } },
    { key: `EmailCodeMail.ignore` },
  ])
}

/** Each role's name, by its key in the `app` catalog: the mail names it as the screens do. */
const ROLE_KEYS: Record<GroupRole, string> = {
  [GroupRole.VIEWER]: `Groups.roleViewer`,
  [GroupRole.EDITOR]: `Groups.roleEditor`,
  [GroupRole.ADMIN]: `Groups.roleAdmin`,
  [GroupRole.OWNER]: `Groups.roleOwner`,
}

/**
 * The mail that carries a group invitation's link: the same link its creator sees. Opening it asks
 * the person to sign in or sign up, then to accept or decline. It is in the inviter's language,
 * since the person invited may have no account yet.
 */
export function invitationMail(
  brand: MailBrand,
  { to, link, groupName, inviterName, role, validDays, reader }: {
    to: string
    link: string
    groupName: string
    /** Empty when the inviter set no name. */
    inviterName: string
    /** The role the person gets. */
    role: GroupRole
    validDays: number
    reader: MailReader
  },
): EmailMessage {
  const w = writerFor(reader)
  const group = isolate(groupName)
  const who = oneLine(inviterName) ? isolate(inviterName) : ``
  const values = { who, group, host: hostOf(brand), role: w.t.t(ROLE_KEYS[role]) }
  return compose(brand, w.t, to, w.t.t(`InvitationMail.subject`, { group }), [
    { key: who ? `InvitationMail.invited` : `InvitationMail.invitedNoName`, values },
    { key: `InvitationMail.open`, values: { count: validDays } },
    { link, label: w.t.t(`InvitationMail.button`) },
    { key: `InvitationMail.account` },
    { key: `InvitationMail.ignore` },
  ])
}

/**
 * The mail that confirms a request to delete the account: when it goes for good, and that signing
 * in before then keeps it. It holds no link that does anything, so a forwarded copy is harmless.
 */
export function accountDeletionMail(
  brand: MailBrand,
  { to, deleteAfter, reader }: { to: string; deleteAfter: Date; reader: MailReader },
): EmailMessage {
  const w = writerFor(reader)
  const date = w.day(deleteAfter)
  return compose(brand, w.t, to, w.t.t(`AccountDeletionMail.subject`, { date }), [
    { key: `AccountDeletionMail.asked`, values: { host: hostOf(brand), date } },
    { key: `AccountDeletionMail.keep` },
    { link: new URL(`/sign-in`, brand.webAppUrl).href, label: w.t.t(`Mail.signIn`) },
    { key: `AccountDeletionMail.notYou` },
  ])
}

/**
 * The mail sent when a sign-in restores an account that was waiting to be deleted, so a person who
 * did not sign in learns that someone else knows their password.
 */
export function accountRestoredMail(
  brand: MailBrand,
  { to, reader }: { to: string; reader: MailReader },
): EmailMessage {
  const w = writerFor(reader)
  return compose(brand, w.t, to, w.t.t(`AccountRestoredMail.subject`), [
    { key: `AccountRestoredMail.restored`, values: { host: hostOf(brand) } },
    { key: `AccountRestoredMail.notYou` },
    { link: new URL(`/sign-in`, brand.webAppUrl).href, label: w.t.t(`Mail.signIn`) },
  ])
}

/**
 * The mail that tells a person their data export is ready (#229). It links to the profile, never
 * to the file: the download needs the person's session.
 */
export function dataExportReadyMail(
  brand: MailBrand,
  { to, expiresAt, reader }: { to: string; expiresAt: Date; reader: MailReader },
): EmailMessage {
  const w = writerFor(reader)
  return compose(brand, w.t, to, w.t.t(`DataExportReadyMail.subject`), [
    { key: `DataExportReadyMail.ready`, values: { date: w.day(expiresAt) } },
    {
      link: new URL(`/profile/account#your-data`, brand.webAppUrl).href,
      label: w.t.t(`Mail.openProfile`),
    },
    { key: `DataExportReadyMail.notYou` },
  ])
}

/** What the mail about a linked or unlinked sign-in method names. */
export interface SignInMethodChangedMailInput {
  to: string
  /** The provider as people know it: `Google`, `GitHub`. */
  provider: string
  /** `true` for a link, `false` for an unlink. */
  linked: boolean
  at: Date
  /** The method is a passkey (#222), which is added and removed rather than linked. */
  passkey?: boolean
  reader: MailReader
}

/**
 * The mail sent when a sign-in method is linked to the account or unlinked from it (#385), so a
 * change made by someone else in an open session does not go unnoticed. A link is a new way in,
 * an unlink takes one away; either way the mail says which provider and when, and what to do when
 * it was not the owner.
 */
export function signInMethodChangedMail(
  brand: MailBrand,
  { to, provider, linked, at, passkey = false, reader }: SignInMethodChangedMailInput,
): EmailMessage {
  const w = writerFor(reader)
  const values = { host: hostOf(brand), when: w.moment(at), provider: isolate(provider) }
  const [subject, changed, notYou] = passkey
    ? linked
      ? [
        `SignInMethodMail.passkeyAddedSubject`,
        `SignInMethodMail.passkeyAdded`,
        `SignInMethodMail.passkeyAddedNotYou`,
      ]
      : [
        `SignInMethodMail.passkeyRemovedSubject`,
        `SignInMethodMail.passkeyRemoved`,
        `SignInMethodMail.passkeyRemovedNotYou`,
      ]
    : linked
    ? [
      `SignInMethodMail.linkedSubject`,
      `SignInMethodMail.linked`,
      `SignInMethodMail.linkedNotYou`,
    ]
    : [
      `SignInMethodMail.unlinkedSubject`,
      `SignInMethodMail.unlinked`,
      `SignInMethodMail.unlinkedNotYou`,
    ]
  return compose(brand, w.t, to, w.t.t(subject, values), [
    { key: changed, values },
    { key: notYou, values },
    // The profile is the web app's first page.
    { link: new URL(`/`, brand.webAppUrl).href, label: w.t.t(`Mail.openProfile`) },
  ])
}

/** What the mail about a new API token names. Never the token itself. */
export interface ApiTokenCreatedMailInput {
  to: string
  name: string
  groupName: string
  canWrite: boolean
  /** `null` for a token that never expires. */
  expiresAt: Date | null
  reader: MailReader
}

/**
 * The mail sent when a personal API token is created, so a token made by someone else in a stolen
 * session does not go unnoticed (#293). It says which token and what it can do, and how to end it:
 * revoke it on the profile page, and change the password, which revokes every token.
 */
export function apiTokenCreatedMail(
  brand: MailBrand,
  { to, name, groupName, canWrite, expiresAt, reader }: ApiTokenCreatedMailInput,
): EmailMessage {
  const w = writerFor(reader)
  const can = canWrite
    ? expiresAt ? `ApiTokenMail.writeUntil` : `ApiTokenMail.writeForever`
    : expiresAt
    ? `ApiTokenMail.readUntil`
    : `ApiTokenMail.readForever`
  return compose(brand, w.t, to, w.t.t(`ApiTokenMail.subject`), [
    { key: `ApiTokenMail.created`, values: { name: isolate(name), host: hostOf(brand) } },
    {
      key: can,
      values: { group: isolate(groupName), date: expiresAt ? w.day(expiresAt) : `` },
    },
    { key: `ApiTokenMail.notYou` },
    // The profile is the web app's first page.
    { link: new URL(`/`, brand.webAppUrl).href, label: w.t.t(`Mail.openProfile`) },
  ])
}

/** What a billing notice mail names. */
export interface BillingNoticeMailInput {
  to: string
  kind: BillingNoticeKind
  groupName: string
  /** The plan's id; its name is the one the app's billing screen shows. */
  planId: string | null
  /** When the trial or the cancelled plan ends; unused for a failed payment. */
  at: Date
  /** The group's Plan and billing tab, where the owner opens the provider's portal. */
  link: string
  /**
   * For a failed payment: until when the plan is kept while the payment is retried. `null` when it
   * is not kept and the group is already on the free plan: a trial whose first charge failed, or a
   * grace period of zero days. Unused for the other notices.
   */
  planKeptUntil: Date | null
  /**
   * For a trial: whether it was started with a card, so it turns into a charged subscription by
   * itself. `false` for a trial without one, which ends on the free plan unless a card is added.
   * Unused for the other notices.
   */
  trialHasCard: boolean
  reader: MailReader
}

/** Each plan's name, by its key in the `app` catalog, as the billing screen names it. */
const PLAN_KEYS: Record<string, string> = {
  [FREE_PLAN_ID]: `GroupBillingPanel.planFree`,
  [PRO_PLAN_ID]: `GroupBillingPanel.planPro`,
}

/**
 * The mail that tells a group's owner its trial ends soon, a payment failed, or its cancelled plan
 * ends. Each one says what happens next and where to change it: the provider's portal, reached from
 * the group's page. Its days are UTC days in the reader's region format, as the billing screen
 * writes them, so the mail and the screen name the same day.
 */
export function billingNoticeMail(
  brand: MailBrand,
  { to, kind, groupName, planId, at, link, planKeptUntil, trialHasCard, reader }:
    BillingNoticeMailInput,
): EmailMessage {
  const w = writerFor(reader)
  const utc = w.format.utc()
  const plan = planId && PLAN_KEYS[planId]
    ? w.t.t(PLAN_KEYS[planId])
    : findPlan(planId ?? ``)?.name ?? w.t.t(`BillingNoticeMail.paidPlan`)
  const values = { plan, group: isolate(groupName), date: utc.date(at, `long`) }
  const [subject, what, next] = {
    [BillingNoticeKind.TrialEnding]: [
      `BillingNoticeMail.trialSubject`,
      `BillingNoticeMail.trialWhat`,
      trialHasCard ? `BillingNoticeMail.trialWithCard` : `BillingNoticeMail.trialWithoutCard`,
    ],
    [BillingNoticeKind.PaymentFailed]: [
      `BillingNoticeMail.paymentSubject`,
      `BillingNoticeMail.paymentWhat`,
      planKeptUntil ? `BillingNoticeMail.paymentKept` : `BillingNoticeMail.paymentFree`,
    ],
    [BillingNoticeKind.PlanEnding]: [
      `BillingNoticeMail.planSubject`,
      `BillingNoticeMail.planWhat`,
      `BillingNoticeMail.planNext`,
    ],
  }[kind]
  const kept = planKeptUntil ? utc.date(planKeptUntil, `long`) : ``
  return compose(brand, w.t, to, w.t.t(subject, values), [
    { key: what, values },
    { key: next, values: { ...values, date: kept || values.date } },
    { link, label: w.t.t(`Mail.openGroup`) },
  ])
}
