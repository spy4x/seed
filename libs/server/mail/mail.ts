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
import { escapeHtml, htmlWrap } from "@spy4x/email/html"
import type { EmailMessage } from "@spy4x/email/message"
import type { Sql } from "@spy4x/server/db"
import { billingDate, BillingNoticeKind } from "@domain/billing"

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

/** The one HTML wrapper every mail uses. `body` must already be escaped. */
export function mailHtml(brand: MailBrand, body: string): string {
  return htmlWrap({ body, brand: new URL(brand.webAppUrl).host, brandUrl: brand.webAppUrl })
}

/** The mail that carries a password reset link. */
export function passwordResetMail(
  brand: MailBrand,
  { to, link, validMinutes }: { to: string; link: string; validMinutes: number },
): EmailMessage {
  const host = new URL(brand.webAppUrl).host
  const asked = `Someone asked to reset the password of your account at ${host}.`
  const open = `Open this link within ${validMinutes} minutes to choose a new password.`
  const once = "The link works once, and using it signs you out everywhere."
  const ignore = "If you did not ask for this, ignore this mail: your password stays as it is."
  return {
    to,
    subject: "Reset your password",
    text: `${asked}\n\n${open}\n\n${link}\n\n${once}\n\n${ignore}\n`,
    html: mailHtml(
      brand,
      [
        `<p>${escapeHtml(asked)}</p>`,
        `<p>${escapeHtml(open)}</p>`,
        `<p><a href="${escapeHtml(link)}">Choose a new password</a></p>`,
        `<p>${escapeHtml(once)}</p>`,
        `<p>${escapeHtml(ignore)}</p>`,
      ].join("\n"),
    ),
  }
}

/**
 * The mail that carries a code proving the address it is sent to. The code is what the person
 * types; the mail holds no link, so nothing in it signs anybody in.
 */
export function emailCodeMail(
  brand: MailBrand,
  { to, code, validMinutes }: { to: string; code: string; validMinutes: number },
): EmailMessage {
  const host = new URL(brand.webAppUrl).host
  const asked = `Enter this code at ${host} to confirm this is your e-mail address.`
  const valid = `It works once, for ${validMinutes} minutes.`
  const ignore = "If you did not ask for this, ignore this mail: nothing changes."
  return {
    to,
    subject: "Your code to confirm your e-mail address",
    text: `${asked}\n\n${code}\n\n${valid}\n\n${ignore}\n`,
    html: mailHtml(
      brand,
      [
        `<p>${escapeHtml(asked)}</p>`,
        `<p style="font-size:24px;font-weight:600;letter-spacing:2px">${escapeHtml(code)}</p>`,
        `<p>${escapeHtml(valid)}</p>`,
        `<p>${escapeHtml(ignore)}</p>`,
      ].join("\n"),
    ),
  }
}

/**
 * The mail that carries a group invitation's link: the same link its creator sees. Opening it asks
 * the person to sign in or sign up, then to accept or decline.
 */
export function invitationMail(
  brand: MailBrand,
  { to, link, groupName, inviterName, roleName, validDays }: {
    to: string
    link: string
    groupName: string
    /** Empty when the inviter set no name. */
    inviterName: string
    /** The role the person gets, such as "editor". */
    roleName: string
    validDays: number
  },
): EmailMessage {
  const host = new URL(brand.webAppUrl).host
  const who = inviterName.trim() || "Someone"
  const invited = `${who} invited you to join "${groupName}" at ${host} as ${roleName}.`
  const open = `Open this link within ${validDays} days to accept or decline.`
  const account =
    "The invitation is for this e-mail address: accept it with the account that uses it."
  const ignore = "If you do not want to join, ignore this mail."
  return {
    to,
    subject: `Invitation to join "${groupName}"`,
    text: `${invited}\n\n${open}\n\n${link}\n\n${account}\n\n${ignore}\n`,
    html: mailHtml(
      brand,
      [
        `<p>${escapeHtml(invited)}</p>`,
        `<p>${escapeHtml(open)}</p>`,
        `<p><a href="${escapeHtml(link)}">Open the invitation</a></p>`,
        `<p>${escapeHtml(account)}</p>`,
        `<p>${escapeHtml(ignore)}</p>`,
      ].join("\n"),
    ),
  }
}

/**
 * The mail that confirms a request to delete the account: when it goes for good, and that signing
 * in before then keeps it. It holds no link that does anything, so a forwarded copy is harmless.
 */
export function accountDeletionMail(
  brand: MailBrand,
  { to, deleteAfter }: { to: string; deleteAfter: Date },
): EmailMessage {
  const host = new URL(brand.webAppUrl).host
  const date = billingDate(deleteAfter)
  const asked = `Your account at ${host} will be deleted for good on ${date}, as you asked.`
  const keep = "Changed your mind? Sign in before then and your account is restored."
  const notYou =
    "If you did not ask for this, sign in now to keep your account, then change your password."
  const link = new URL("/sign-in", brand.webAppUrl).href
  return {
    to,
    subject: `Your account will be deleted on ${date}`,
    text: `${asked}\n\n${keep}\n\n${link}\n\n${notYou}\n`,
    html: mailHtml(
      brand,
      [
        `<p>${escapeHtml(asked)}</p>`,
        `<p>${escapeHtml(keep)}</p>`,
        `<p><a href="${escapeHtml(link)}">Sign in</a></p>`,
        `<p>${escapeHtml(notYou)}</p>`,
      ].join("\n"),
    ),
  }
}

/**
 * The mail sent when a sign-in restores an account that was waiting to be deleted, so a person who
 * did not sign in learns that someone else knows their password.
 */
export function accountRestoredMail(brand: MailBrand, { to }: { to: string }): EmailMessage {
  const host = new URL(brand.webAppUrl).host
  const restored =
    `Your account at ${host} was restored by a sign-in, so it will no longer be deleted.`
  const notYou = "If this wasn't you, sign in, delete your account again and change your password."
  const link = new URL("/sign-in", brand.webAppUrl).href
  return {
    to,
    subject: "Your account was restored",
    text: `${restored}\n\n${notYou}\n\n${link}\n`,
    html: mailHtml(
      brand,
      [
        `<p>${escapeHtml(restored)}</p>`,
        `<p>${escapeHtml(notYou)}</p>`,
        `<p><a href="${escapeHtml(link)}">Sign in</a></p>`,
      ].join("\n"),
    ),
  }
}

/** What the mail about a new API token names. Never the token itself. */
export interface ApiTokenCreatedMailInput {
  to: string
  name: string
  groupName: string
  canWrite: boolean
  /** `null` for a token that never expires. */
  expiresAt: Date | null
}

/**
 * The mail sent when a personal API token is created, so a token made by someone else in a stolen
 * session does not go unnoticed (#293). It says which token and what it can do, and how to end it:
 * revoke it on the profile page, and change the password, which revokes every token.
 */
export function apiTokenCreatedMail(
  brand: MailBrand,
  { to, name, groupName, canWrite, expiresAt }: ApiTokenCreatedMailInput,
): EmailMessage {
  const host = new URL(brand.webAppUrl).host
  const created = `An API token named "${name}" was created for your account at ${host}.`
  const can = `It can ${canWrite ? "read and write" : "read"} the group "${groupName}" and ${
    expiresAt ? `expires on ${billingDate(expiresAt)}` : "never expires"
  }.`
  const notYou =
    "If this wasn't you, revoke the token on your profile page and change your password, which revokes every API token."
  // The profile is the web app's first page.
  const link = new URL("/", brand.webAppUrl).href
  return {
    to,
    subject: "An API token was created",
    text: `${created}\n\n${can}\n\n${notYou}\n\n${link}\n`,
    html: mailHtml(
      brand,
      [
        `<p>${escapeHtml(created)}</p>`,
        `<p>${escapeHtml(can)}</p>`,
        `<p>${escapeHtml(notYou)}</p>`,
        `<p><a href="${escapeHtml(link)}">Open your profile</a></p>`,
      ].join("\n"),
    ),
  }
}

/** What a billing notice mail names. */
export interface BillingNoticeMailInput {
  to: string
  kind: BillingNoticeKind
  groupName: string
  planName: string
  /** When the trial or the cancelled plan ends; unused for a failed payment. */
  at: Date
  /** The group's page, where the owner opens the provider's portal. */
  link: string
  /**
   * For a failed payment: whether the plan is kept for the grace period. A trial whose first charge
   * failed has none (`false`): the group is already on the free plan. Unused for the other notices.
   */
  planKept: boolean
}

/**
 * The mail that tells a group's owner its trial ends soon, a payment failed, or its cancelled plan
 * ends. Each one says what happens next and where to change it: the provider's portal, reached from
 * the group's page.
 */
export function billingNoticeMail(
  brand: MailBrand,
  { to, kind, groupName, planName, at, link, planKept }: BillingNoticeMailInput,
): EmailMessage {
  const group = `"${groupName}"`
  const date = billingDate(at)
  const [subject, what, next] = {
    [BillingNoticeKind.TrialEnding]: [
      `Your ${planName} trial ends on ${date}`,
      `The ${planName} trial of ${group} ends on ${date}.`,
      `The subscription then starts and is charged. To stop it, cancel it before then from the group's page.`,
    ],
    [BillingNoticeKind.PaymentFailed]: [
      `A payment for ${planName} failed`,
      `A payment for the ${planName} plan of ${group} failed.`,
      planKept
        ? `The plan is kept for a few days while the payment is retried. Update the card from the group's page to keep it.`
        : `The group is now on the free plan. Update the card from the group's page to get the plan back.`,
    ],
    [BillingNoticeKind.PlanEnding]: [
      `Your ${planName} plan ends on ${date}`,
      `The ${planName} plan of ${group} was cancelled and ends on ${date}; the group then moves to the free plan.`,
      `Changed your mind? Renew it from the group's page before then.`,
    ],
  }[kind]
  return {
    to,
    subject,
    text: `${what}\n\n${next}\n\n${link}\n`,
    html: mailHtml(
      brand,
      [
        `<p>${escapeHtml(what)}</p>`,
        `<p>${escapeHtml(next)}</p>`,
        `<p><a href="${escapeHtml(link)}">Open the group</a></p>`,
      ].join("\n"),
    ),
  }
}
