import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { Sql } from "@spy4x/server/db"
import { BillingNoticeKind, PRO_PLAN_ID } from "@domain/billing"
import { GroupRole } from "@domain/groups"
import { LANGUAGES } from "@domain/identity"
import { createTranslator } from "@spy4x/platform/universal/i18n"
import {
  accountDeletionMail,
  accountRestoredMail,
  apiTokenCreatedMail,
  billingNoticeMail,
  compose,
  createMailSender,
  dataExportReadyMail,
  emailCodeMail,
  invitationMail,
  mailOffWarning,
  type MailReader,
  MailTransport,
  messageHtml,
  passwordResetMail,
  readMailSetup,
  signInLinkMail,
  signInMethodChangedMail,
  SMTP_KEYS,
} from "./mail.ts"

/** An English reader in UTC with a 24-hour clock: the dates these tests pin. */
const EN: MailReader = { language: "en", locale: "en-US", timeZone: "UTC", hourCycle: "h23" }

/** A value as a mail's text part writes it: isolated between FSI and PDI. */
const iso = (value: string) => `\u2068${value}\u2069`

const env = (values: Record<string, string>) => ({ get: (name: string) => values[name] })

const SMTP = {
  SMTP_HOST: "smtp.example.com",
  SMTP_PORT: "587",
  SMTP_USER: "mailer",
  SMTP_PASS: "not-a-real-password",
  SMTP_FROM: "App <hi@example.com>",
}

describe("readMailSetup", () => {
  it("uses the console in development, even with SMTP set", () => {
    expect(readMailSetup(env({ ENV: "dev", ...SMTP }))).toEqual({
      transport: MailTransport.Console,
    })
  })

  it("uses SMTP in production when every SMTP key is set", () => {
    expect(readMailSetup(env({ ENV: "prod", ...SMTP }))).toEqual({
      transport: MailTransport.Smtp,
      smtp: {
        host: "smtp.example.com",
        port: 587,
        user: "mailer",
        pass: "not-a-real-password",
        from: "App <hi@example.com>",
      },
    })
  })

  it("turns mail off in production without SMTP, never falling back to the console", () => {
    for (const ENV of ["prod", "staging", ""]) {
      expect(readMailSetup(env({ ENV }))).toEqual({
        transport: MailTransport.Off,
        missing: [...SMTP_KEYS],
      })
    }
  })

  it("names only the missing keys, and counts a port that is not one as missing", () => {
    const setup = readMailSetup(env({ ENV: "prod", ...SMTP, SMTP_PORT: "smtp", SMTP_PASS: " " }))

    expect(setup).toEqual({ transport: MailTransport.Off, missing: ["SMTP_PORT", "SMTP_PASS"] })
  })
})

describe("mailOffWarning", () => {
  it("names the missing keys and carries none of the values that are set", () => {
    const setup = readMailSetup(env({ ENV: "prod", SMTP_PASS: "not-a-real-password" }))

    const warning = mailOffWarning(setup)!

    for (const key of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_FROM"]) {
      expect(warning).toContain(key)
    }
    expect(warning).not.toContain("not-a-real-password")
  })

  it("says nothing when mail is sent", () => {
    expect(mailOffWarning(readMailSetup(env({ ENV: "prod", ...SMTP })))).toBe(null)
    expect(mailOffWarning(readMailSetup(env({ ENV: "dev" })))).toBe(null)
  })
})

/** A stand-in for the Postgres client that records every statement's values. */
function recordingSql(): { sql: Sql; rows: unknown[][] } {
  const rows: unknown[][] = []
  const sql = ((_strings: TemplateStringsArray, ...values: unknown[]) => {
    rows.push(values)
    return Promise.resolve([])
  }) as unknown as Sql
  return { sql, rows }
}

describe("createMailSender", () => {
  it("sends nothing when mail is off", () => {
    const { sql } = recordingSql()

    expect(createMailSender({ transport: MailTransport.Off, missing: ["SMTP_HOST"] }, sql)).toBe(
      null,
    )
  })

  it("keeps a copy of each development mail in dev_mail for the e2e specs", async () => {
    const { sql, rows } = recordingSql()
    const sender = createMailSender({ transport: MailTransport.Console }, sql)!

    const result = await sender.send({ to: "ann@example.com", subject: "Hi", text: "Hello" })

    expect(result.ok).toBe(true)
    expect(rows).toEqual([["ann@example.com", "Hi", "Hello"]])
  })
})

describe("passwordResetMail", () => {
  const link = "https://app.example.com/reset-password?email=ann%40example.com&code=abc"
  const mail = passwordResetMail(
    { webAppUrl: "https://app.example.com" },
    { to: "ann@example.com", reader: EN, link, validMinutes: 30 },
  )

  it("carries the link and how long it works in the text and the HTML", () => {
    expect(mail.to).toBe("ann@example.com")
    expect(mail.subject).toBe("Reset your password")
    expect(mail.text).toContain(link)
    expect(mail.text).toContain("30 minutes")
    expect(mail.html).toContain(`href="${link.replace("&", "&amp;")}"`)
  })

  it("wraps the HTML in the shared shell, branded with the app's host", () => {
    expect(mail.html).toMatch(/^<!doctype html>/)
    expect(mail.html).toContain(">app.example.com</a>")
  })
})

describe("signInLinkMail", () => {
  const link = "https://app.example.com/sign-in/link/open#token=abc.def"
  const mail = signInLinkMail(
    { webAppUrl: "https://app.example.com" },
    {
      to: "ann@example.com",
      reader: EN,
      link,
      validMinutes: 15,
      at: new Date("2026-10-23T14:03:00Z"),
    },
  )

  it("carries the link, its fifteen minutes and when it was asked for, in the text and the HTML", () => {
    expect(mail.to).toBe("ann@example.com")
    expect(mail.subject).toBe("Your sign-in link for app.example.com")
    expect(mail.text).toContain(`\n${link}\n`)
    expect(mail.text).toContain("within 15 minutes")
    expect(mail.text).toContain("on October 23, 2026 at 14:03.")
    expect(mail.html).toContain(`href="${link}"`)
    expect(mail.html).toContain("Sign in to app.example.com")
  })

  it("says the link creates an account for a new address and waits for Continue", () => {
    expect(mail.text).toContain("If no account uses this address yet, it creates one.")
    expect(mail.text).toContain("nothing happens until you press it")
  })
})

describe("accountDeletionMail", () => {
  const mail = accountDeletionMail(
    { webAppUrl: "https://app.example.com" },
    { to: "ann@example.com", reader: EN, deleteAfter: new Date("2026-10-11T09:30:00Z") },
  )

  it("names the day the account goes and says that signing in before then keeps it", () => {
    expect(mail.to).toBe("ann@example.com")
    expect(mail.subject).toBe("Your account will be deleted on October 11, 2026")
    expect(mail.text).toContain("deleted for good on October 11, 2026")
    expect(mail.text).toContain("Sign in before then and your account is restored")
    expect(mail.text).toContain("https://app.example.com/sign-in")
    expect(mail.html).toContain(`href="https://app.example.com/sign-in"`)
  })
})

describe("apiTokenCreatedMail", () => {
  const input = {
    to: "ann@example.com",
    reader: EN,
    name: `Zapier <script>`,
    groupName: "Family & co",
    canWrite: true,
    expiresAt: new Date("2027-01-02T10:00:00Z"),
  }
  const mail = apiTokenCreatedMail({ webAppUrl: "https://app.example.com" }, input)

  it("names the token, its group, what it can do and when it expires", () => {
    expect(mail.to).toBe("ann@example.com")
    expect(mail.subject).toBe("An API token was created")
    expect(mail.text).toContain(`An API token named "${iso("Zapier <script>")}" was created`)
    expect(mail.text).toContain(
      `It can read and write the group "${iso("Family & co")}" and expires on January 2, 2027.`,
    )
  })

  it("says a read-only token that never expires is just that", () => {
    const readOnly = apiTokenCreatedMail({ webAppUrl: "https://app.example.com" }, {
      ...input,
      canWrite: false,
      expiresAt: null,
    })
    expect(readOnly.text).toContain(
      `It can read the group "${iso("Family & co")}" and never expires.`,
    )
  })

  it("says what to do if it was someone else: revoke it and change the password", () => {
    expect(mail.text).toContain("If this wasn't you, revoke the token on your profile page")
    expect(mail.text).toContain("change your password, which revokes every API token")
    expect(mail.text).toContain("https://app.example.com/")
  })

  it("escapes the token's and the group's name in the HTML", () => {
    expect(mail.html).toContain("Zapier &lt;script&gt;")
    expect(mail.html).toContain("Family &amp; co")
    expect(mail.html).not.toContain("<script>")
  })
})

describe("accountRestoredMail", () => {
  const mail = accountRestoredMail({ webAppUrl: "https://app.example.com" }, {
    to: "ann@example.com",
    reader: EN,
  })

  it("says a sign-in restored the account and what to do if it was someone else", () => {
    expect(mail.to).toBe("ann@example.com")
    expect(mail.subject).toBe("Your account was restored")
    expect(mail.text).toContain("app.example.com was restored by a sign-in")
    expect(mail.text).toContain("If this wasn't you, sign in, delete your account again and change")
    expect(mail.html).toContain(`href="https://app.example.com/sign-in"`)
  })
})

describe("dataExportReadyMail", () => {
  const mail = dataExportReadyMail({ webAppUrl: "https://app.example.com" }, {
    to: "ann@example.com",
    reader: EN,
    expiresAt: new Date("2026-10-30T10:00:00Z"),
  })

  it("says until when the file waits, links to the profile and never to the file", () => {
    expect(mail.subject).toBe("Your data is ready")
    expect(mail.text).toContain("Download it from your profile until")
    expect(mail.text).toContain("2026")
    expect(mail.html).toContain(`href="https://app.example.com/profile/account#your-data"`)
    expect(`${mail.text}${mail.html}`).not.toContain("data-export")
    expect(mail.text).toContain("If you did not ask for this, change your password")
  })
})

describe("signInMethodChangedMail", () => {
  const brand = { webAppUrl: "https://app.example.com" }
  const at = new Date("2026-10-15T14:03:00Z")

  it("names the linked provider and the time, and says to unlink it if it was someone else", () => {
    const mail = signInMethodChangedMail(brand, {
      to: "ann@example.com",
      reader: EN,
      provider: "Google",
      linked: true,
      at,
    })
    expect(mail.to).toBe("ann@example.com")
    expect(mail.subject).toBe("Google was linked to your account")
    expect(mail.text).toContain(
      `${
        iso("Google")
      } was linked to your account at app.example.com on October 15, 2026 at 14:03.`,
    )
    expect(mail.text).toContain(`If this wasn't you, unlink ${iso("Google")} on your profile page`)
    expect(mail.html).toContain(`href="https://app.example.com/"`)
  })

  it("names the unlinked provider and the time, and says to change the password if it was someone else", () => {
    const mail = signInMethodChangedMail(brand, {
      to: "ann@example.com",
      reader: EN,
      provider: "GitHub",
      linked: false,
      at,
    })
    expect(mail.subject).toBe("GitHub was unlinked from your account")
    expect(mail.text).toContain(
      `${
        iso("GitHub")
      } was unlinked from your account at app.example.com on October 15, 2026 at 14:03.`,
    )
    expect(mail.text).toContain(
      `If this wasn't you, sign in, change your password and link ${iso("GitHub")} again.`,
    )
  })
})

describe("signInMethodChangedMail for a passkey", () => {
  const brand = { webAppUrl: "https://app.example.com" }
  const at = new Date("2026-10-15T14:03:00Z")

  it("says a passkey was added, and to remove it and change the password if it was someone else", () => {
    const mail = signInMethodChangedMail(brand, {
      to: "ann@example.com",
      reader: EN,
      provider: "A passkey",
      linked: true,
      at,
      passkey: true,
    })
    expect(mail.subject).toBe("A passkey was added to your account")
    expect(mail.text).toContain(
      "A passkey was added to your account at app.example.com on October 15, 2026 at 14:03.",
    )
    expect(mail.text).toContain(
      "If this wasn't you, remove the passkey on your profile page and change your password.",
    )
    expect(mail.html).toContain(`href="https://app.example.com/"`)
  })

  it("says a passkey was removed, and to add it again if it was someone else", () => {
    const mail = signInMethodChangedMail(brand, {
      to: "ann@example.com",
      reader: EN,
      provider: "A passkey",
      linked: false,
      at,
      passkey: true,
    })
    expect(mail.subject).toBe("A passkey was removed from your account")
    expect(mail.text).toContain(
      "If this wasn't you, sign in, change your password and add your passkey again.",
    )
  })
})

describe("emailCodeMail", () => {
  const mail = emailCodeMail(
    { webAppUrl: "https://app.example.com" },
    { to: "ann@example.com", reader: EN, code: "a<b-C9_z", validMinutes: 10 },
  )

  it("carries the code and how long it works in the text and the escaped HTML, with no link", () => {
    expect(mail.to).toBe("ann@example.com")
    expect(mail.text).toContain("\na<b-C9_z\n")
    expect(mail.text).toContain("10 minutes")
    expect(mail.html).toContain(`<span dir="ltr">a&lt;b-C9_z</span>`)
    expect(mail.html).not.toContain("a<b-C9_z")
    expect(mail.text).not.toMatch(/https?:\/\//)
  })
})

describe("invitationMail", () => {
  const link = "https://app.example.com/invite/abc_DEF-123"
  const mail = invitationMail(
    { webAppUrl: "https://app.example.com" },
    {
      to: "bo@example.com",
      reader: EN,
      link,
      groupName: `<b>Team</b> "A"`,
      inviterName: "Ann",
      role: GroupRole.EDITOR,
      validDays: 7,
    },
  )

  it("carries the link, the group, the inviter, the role and how long it works", () => {
    expect(mail.to).toBe("bo@example.com")
    expect(mail.subject).toBe(`Invitation to join "<b>Team</b> "A""`)
    expect(mail.text).toContain(link)
    expect(mail.text).toContain(
      `${iso("Ann")} invited you to join "${iso(`<b>Team</b> "A"`)}" at app.example.com`,
    )
    expect(mail.text).toContain("with the role Editor")
    expect(mail.text).toContain("7 days")
    expect(mail.html).toContain(`href="${link}"`)
  })

  it("escapes the group's name in the HTML", () => {
    expect(mail.html).not.toContain("<b>Team</b>")
    expect(mail.html).toContain("&lt;b&gt;Team&lt;/b&gt;")
  })

  it("names nobody when the inviter set no name", () => {
    const anonymous = invitationMail(
      { webAppUrl: "https://app.example.com" },
      {
        to: "bo@example.com",
        reader: EN,
        link,
        groupName: "Team",
        inviterName: " ",
        role: GroupRole.VIEWER,
        validDays: 1,
      },
    )
    expect(anonymous.text).toMatch(/^You are invited to join "\u2068Team\u2069"/)
  })
})

describe("billingNoticeMail", () => {
  const brand = { webAppUrl: "https://app.example.com" }
  const link = "https://app.example.com/groups/7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002"
  const mail = (kind: BillingNoticeKind) =>
    billingNoticeMail(brand, {
      to: "ann@example.com",
      reader: EN,
      kind,
      groupName: "Tea <club>",
      planId: PRO_PLAN_ID,
      at: new Date("2026-10-15T23:30:00Z"),
      link,
      planKeptUntil: new Date("2026-10-22T23:30:00Z"),
      trialHasCard: true,
    })

  it("says when a trial ends, in UTC, and that it is charged unless cancelled", () => {
    const trial = mail(BillingNoticeKind.TrialEnding)

    expect(trial.to).toBe("ann@example.com")
    expect(trial.subject).toBe("Your Pro trial ends on October 15, 2026")
    expect(trial.text).toContain("is charged. To stop it, cancel it before then")
    expect(trial.text).toContain(link)
  })

  it("says a payment failed and the card needs updating to keep the plan", () => {
    const failed = mail(BillingNoticeKind.PaymentFailed)

    expect(failed.subject).toBe("A payment for Pro failed")
    expect(failed.text).toContain("Update the card from the group's page to keep it.")
  })

  it("tells a failed trial's owner the group is already on the free plan", () => {
    const failedTrial = billingNoticeMail(brand, {
      to: "ann@example.com",
      reader: EN,
      kind: BillingNoticeKind.PaymentFailed,
      groupName: "Tea club",
      planId: PRO_PLAN_ID,
      at: new Date("2026-10-15T23:30:00Z"),
      link,
      planKeptUntil: null,
      trialHasCard: true,
    })

    expect(failedTrial.text).toContain("The group is now on the free plan.")
    expect(failedTrial.text).not.toContain("is kept")
  })

  it("names the day the grace period ends, in UTC, when the plan is kept", () => {
    const failed = mail(BillingNoticeKind.PaymentFailed)

    expect(failed.text).toContain(
      "The plan is kept until October 22, 2026 while the payment is retried.",
    )
  })

  it("tells the owner of a trial without a card that it ends on the free plan unless one is added", () => {
    const cardless = billingNoticeMail(brand, {
      to: "ann@example.com",
      reader: EN,
      kind: BillingNoticeKind.TrialEnding,
      groupName: "Tea club",
      planId: PRO_PLAN_ID,
      at: new Date("2026-10-15T23:30:00Z"),
      link,
      planKeptUntil: null,
      trialHasCard: false,
    })

    expect(cardless.subject).toBe("Your Pro trial ends on October 15, 2026")
    expect(cardless.text).toContain("Add a card from the group's page before then to keep the plan")
    expect(cardless.text).toContain("Without a card, the group moves to the free plan.")
    expect(cardless.text).not.toContain("To stop it, cancel it")
  })

  it("says when a cancelled plan ends and that it can still be renewed", () => {
    const ending = mail(BillingNoticeKind.PlanEnding)

    expect(ending.subject).toBe("Your Pro plan ends on October 15, 2026")
    expect(ending.text).toContain("Renew it from the group's page before then.")
  })

  it("escapes the group's name in the HTML and links to the group", () => {
    const html = mail(BillingNoticeKind.PlanEnding).html!

    expect(html).toContain("Tea &lt;club&gt;")
    expect(html).not.toContain("<club>")
    expect(html).toContain(`href="${link}"`)
  })
})

const brand = { webAppUrl: "https://app.example.com" }
const AT = new Date("2026-10-15T14:03:00Z")

/** Every mail the template sends, built for `reader`. */
function everyMail(reader: MailReader) {
  const link = "https://app.example.com/x"
  return [
    passwordResetMail(brand, { to: "a@example.com", link, validMinutes: 30, reader }),
    signInLinkMail(brand, { to: "a@example.com", link, validMinutes: 15, at: AT, reader }),
    emailCodeMail(brand, { to: "a@example.com", code: "ABCD1234", validMinutes: 10, reader }),
    invitationMail(brand, {
      to: "a@example.com",
      link,
      groupName: "Team",
      inviterName: "Ann",
      role: GroupRole.EDITOR,
      validDays: 7,
      reader,
    }),
    accountDeletionMail(brand, { to: "a@example.com", deleteAfter: AT, reader }),
    accountRestoredMail(brand, { to: "a@example.com", reader }),
    dataExportReadyMail(brand, { to: "a@example.com", expiresAt: AT, reader }),
    signInMethodChangedMail(brand, {
      to: "a@example.com",
      provider: "Google",
      linked: true,
      at: AT,
      reader,
    }),
    apiTokenCreatedMail(brand, {
      to: "a@example.com",
      name: "CI",
      groupName: "Team",
      canWrite: true,
      expiresAt: AT,
      reader,
    }),
    billingNoticeMail(brand, {
      to: "a@example.com",
      kind: BillingNoticeKind.TrialEnding,
      groupName: "Team",
      planId: PRO_PLAN_ID,
      at: AT,
      link,
      planKeptUntil: null,
      trialHasCard: true,
      reader,
    }),
  ]
}

describe("mail in the reader's language (#277)", () => {
  const english = everyMail(EN)

  for (const language of LANGUAGES) {
    it(`writes every mail in ${language}, with ${language} on the html element`, () => {
      const reader: MailReader = { ...EN, language }
      everyMail(reader).forEach((mail, index) => {
        expect(mail.html).toContain(`<html lang="${language}"`)
        // A key the translator did not find is written as the key itself.
        expect(`${mail.subject}\n${mail.text}`).not.toMatch(/\b[A-Z]\w+Mail\.\w+/)
        if (language !== "en") {
          expect(mail.subject).not.toBe(english[index].subject)
          expect(mail.text).not.toBe(english[index].text)
        }
      })
    })
  }

  it("writes Arabic right to left, and every other language left to right", () => {
    for (const mail of everyMail({ ...EN, language: "ar" })) {
      expect(mail.html).toContain(`<html lang="ar" dir="rtl">`)
    }
    for (const mail of everyMail({ ...EN, language: "de" })) {
      expect(mail.html).toContain(`<html lang="de" dir="ltr">`)
    }
  })

  it("signs the mail in the reader's language", () => {
    const [german] = everyMail({ ...EN, language: "de" })
    expect(german.html).toContain("— Gesendet von")
    expect(german.html).not.toContain("Sent by")
  })

  it("writes a time in the reader's zone and region format, with no UTC suffix", () => {
    const berlin = signInMethodChangedMail(brand, {
      to: "a@example.com",
      provider: "Google",
      linked: true,
      at: AT,
      reader: { language: "de", locale: "de-DE", timeZone: "Europe/Berlin", hourCycle: null },
    })
    expect(berlin.text).toContain("am 15. Oktober 2026 um 16:03 mit deinem Konto")
    expect(berlin.text).not.toContain("UTC")

    const newYork = signInLinkMail(brand, {
      to: "a@example.com",
      link: "https://app.example.com/x",
      validMinutes: 15,
      at: AT,
      reader: { language: "en", locale: "en-US", timeZone: "America/New_York", hourCycle: null },
    })
    expect(newYork.text).toContain("on October 15, 2026 at 10:03 AM.")
  })

  it("says a time is in UTC when the reader's zone is unknown", () => {
    const unknown = signInLinkMail(brand, {
      to: "a@example.com",
      link: "https://app.example.com/x",
      validMinutes: 15,
      at: AT,
      reader: { language: "en", locale: "en-GB", timeZone: null, hourCycle: null },
    })
    expect(unknown.text).toContain("on 15 October 2026 at 14:03 UTC.")
  })

  it("writes a day in the reader's zone, where it may already be tomorrow", () => {
    const lateEvening = new Date("2026-10-15T23:30:00Z")
    const tokyo = accountDeletionMail(brand, {
      to: "a@example.com",
      deleteAfter: lateEvening,
      reader: { language: "en", locale: "en-GB", timeZone: "Asia/Tokyo", hourCycle: null },
    })
    expect(tokyo.subject).toBe("Your account will be deleted on 16 October 2026")
  })

  it("writes a billing day as the billing screen does: the UTC day, in the reader's format", () => {
    const [notice] = everyMail({
      language: "de",
      locale: "de-DE",
      timeZone: "Pacific/Auckland",
      hourCycle: null,
    }).slice(-1)
    expect(notice.subject).toBe("Deine Pro-Testphase endet am 15. Oktober 2026")
  })

  it("names a role and a plan as the app's screens do, in the reader's language", () => {
    const mails = everyMail({ ...EN, language: "de" })
    expect(mails[3].text).toContain("mit der Rolle Bearbeiter")
    expect(mails[9].text).toContain("Die Pro-Testphase")
  })
})

describe("mail and a hostile value (#277)", () => {
  const hostile =
    `Team\r\nBcc: victim@example.com\n<img src=x onerror=alert(1)>"><a href="javascript:alert(1)">x</a>`

  it("keeps a line break in a value out of the subject, whatever the mail", () => {
    const invitation = invitationMail(brand, {
      to: "a@example.com",
      link: "https://app.example.com/invite/abc",
      groupName: hostile,
      inviterName: hostile,
      role: GroupRole.VIEWER,
      validDays: 7,
      reader: EN,
    })
    const linked = signInMethodChangedMail(brand, {
      to: "a@example.com",
      provider: hostile,
      linked: true,
      at: AT,
      reader: EN,
    })
    const billing = billingNoticeMail(brand, {
      to: "a@example.com",
      kind: BillingNoticeKind.PlanEnding,
      groupName: hostile,
      planId: PRO_PLAN_ID,
      at: AT,
      link: "https://app.example.com/groups/1/billing",
      planKeptUntil: null,
      trialHasCard: true,
      reader: EN,
    })
    for (const mail of [invitation, linked, billing]) {
      expect(mail.subject).not.toMatch(/[\r\n]/)
      expect(mail.text).not.toMatch(/^Bcc:/m)
    }
    expect(invitation.subject).toBe(
      `Invitation to join "Team Bcc: victim@example.com <img src=x onerror=alert(1)>"><a href="javascript:alert(1)">x</a>"`,
    )
  })

  it("adds no markup and no link from a value, in any language", () => {
    for (const language of LANGUAGES) {
      const mail = invitationMail(brand, {
        to: "a@example.com",
        link: "https://app.example.com/invite/abc",
        groupName: hostile,
        inviterName: hostile,
        role: GroupRole.VIEWER,
        validDays: 7,
        reader: { ...EN, language },
      })
      expect(mail.html).not.toContain("<img")
      expect(mail.html).not.toContain(`href="javascript`)
      expect(mail.html).toContain("&lt;img src=x onerror=alert(1)&gt;")
      // The only links are the template's: the invitation and the brand.
      expect(mail.html?.match(/href="/g)).toHaveLength(3)
      // The inviter's name is the one bold span the catalog allows, and stays text inside it.
      expect(mail.html).toContain("<strong><bdi>Team Bcc: victim@example.com &lt;img")
    }
  })

  it("escapes the catalog's own text, so a translation cannot add markup either", () => {
    const mail = invitationMail(brand, {
      to: "a@example.com",
      link: "https://app.example.com/invite/abc",
      groupName: "Team",
      inviterName: "Ann",
      role: GroupRole.VIEWER,
      validDays: 7,
      reader: EN,
    })
    // The quotes around the group's name are the catalog's, not the value's.
    expect(mail.html).toContain("join &quot;<bdi>Team</bdi>&quot; at")
  })
})

describe("mail and a full stop after a date (#277)", () => {
  /** Each language with a region format of its own, whose long date may end in a full stop. */
  const LOCALES = { en: "en-US", ru: "ru-RU", es: "es-ES", de: "de-DE", "pt-BR": "pt-BR", ar: "ar" }
  /** A letter's full stop, then the sentence's, with only closing tags or a PDI between them. */
  const DOUBLED = /\p{L}\.(?:<\/\w+>|\u2069)*\.(?!\.)/u

  it("writes one full stop after a Russian date that ends in «г.»", () => {
    const [deletion] = everyMail({ ...EN, language: "ru", locale: "ru-RU" }).slice(4)
    expect(deletion.text).toContain("удалён 15 октября 2026 г.")
    expect(deletion.text).not.toContain("г..")
    expect(deletion.html).toContain("<strong>15 октября 2026 г.</strong></p>")
  })

  for (const [language, locale] of Object.entries(LOCALES)) {
    it(`writes no doubled full stop after a date in ${language}`, () => {
      for (
        const mail of everyMail({ ...EN, language: language as MailReader["language"], locale })
      ) {
        expect(`${mail.subject}\n${mail.text}`).not.toMatch(DOUBLED)
        expect(mail.html).not.toMatch(DOUBLED)
      }
    })
  }

  it("leaves an ellipsis alone", () => {
    const t = createTranslator({ language: "en", catalogs: [{ source: { "T.x": "Wait..." } }] })
    expect(messageHtml(t, "T.x")).toBe("Wait...")
  })
})

describe("mail and a value in another direction (#277)", () => {
  const value = "Team (EU)!"
  const ar: MailReader = { ...EN, language: "ar", locale: "ar" }
  const mails = () => [
    invitationMail(brand, {
      to: "a@example.com",
      link: "https://app.example.com/x",
      groupName: value,
      inviterName: value,
      role: GroupRole.VIEWER,
      validDays: 7,
      reader: ar,
    }),
    apiTokenCreatedMail(brand, {
      to: "a@example.com",
      name: value,
      groupName: value,
      canWrite: false,
      expiresAt: null,
      reader: ar,
    }),
    signInMethodChangedMail(brand, {
      to: "a@example.com",
      provider: value,
      linked: true,
      at: AT,
      reader: ar,
    }),
    billingNoticeMail(brand, {
      to: "a@example.com",
      kind: BillingNoticeKind.PlanEnding,
      groupName: value,
      planId: PRO_PLAN_ID,
      at: AT,
      link: "https://app.example.com/x",
      planKeptUntil: null,
      trialHasCard: true,
      reader: ar,
    }),
  ]

  it("isolates a person's value in Arabic mail: bdi in the HTML, FSI and PDI in the text", () => {
    for (const mail of mails()) {
      expect(mail.html).toContain(`<bdi>${value}</bdi>`)
      expect(mail.html).not.toMatch(/[\u2066-\u2069]/)
      expect(mail.text).toContain(`\u2068${value}\u2069`)
      // Every value is isolated: no copy of it stands outside the marks.
      expect(mail.text!.replaceAll(`\u2068${value}\u2069`, ``)).not.toContain(value)
    }
  })

  it("keeps isolate marks out of the subject, which some mail clients draw as boxes", () => {
    for (const mail of mails()) expect(mail.subject).not.toMatch(/[\u2066-\u2069]/)
    expect(mails()[0].subject).toContain(value)
  })

  it("lets no value close its isolation early, and still escapes it", () => {
    const mail = invitationMail(brand, {
      to: "a@example.com",
      link: "https://app.example.com/x",
      groupName: "Team\u2069 <i>(EU)</i>!\u2068",
      inviterName: "",
      role: GroupRole.VIEWER,
      validDays: 7,
      reader: ar,
    })
    expect(mail.html).toContain("<bdi>Team &lt;i&gt;(EU)&lt;/i&gt;!</bdi>")
    expect(mail.text).toContain("\u2068Team <i>(EU)</i>!\u2069")
  })
})

describe("mail and the catalog's own markup (#277)", () => {
  it("draws only strong from a message's tags, and every other tag as its text", () => {
    const t = createTranslator({
      language: "en",
      catalogs: [{
        source: { "T.x": "<strong>{v}</strong> <em>{v}</em> <a>{v}</a> <script>{v}</script>" },
      }],
    })
    expect(messageHtml(t, "T.x", { v: "x" })).toBe("<strong>x</strong> x x x")
  })

  it("writes a subject on one line, even when the translation has a line break", () => {
    const t = createTranslator({ language: "en", catalogs: [{ source: {} }] })
    const mail = compose(brand, t, "a@example.com", "First\r\nBcc: b@example.com\u2028end", [])
    expect(mail.subject).toBe("First Bcc: b@example.com end")
  })
})
