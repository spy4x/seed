import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { Sql } from "@spy4x/server/db"
import { BillingNoticeKind } from "@domain/billing"
import {
  accountDeletionMail,
  accountRestoredMail,
  apiTokenCreatedMail,
  billingNoticeMail,
  createMailSender,
  dataExportReadyMail,
  emailCodeMail,
  invitationMail,
  mailOffWarning,
  MailTransport,
  passwordResetMail,
  readMailSetup,
  signInLinkMail,
  signInMethodChangedMail,
  SMTP_KEYS,
} from "./mail.ts"

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
    { to: "ann@example.com", link, validMinutes: 30 },
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
    { to: "ann@example.com", link, validMinutes: 15, at: new Date("2026-10-23T14:03:00Z") },
  )

  it("carries the link, its fifteen minutes and when it was asked for, in the text and the HTML", () => {
    expect(mail.to).toBe("ann@example.com")
    expect(mail.subject).toBe("Your sign-in link for app.example.com")
    expect(mail.text).toContain(`\n${link}\n`)
    expect(mail.text).toContain("within 15 minutes")
    expect(mail.text).toContain("on October 23, 2026 at 14:03 UTC")
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
    { to: "ann@example.com", deleteAfter: new Date("2026-10-11T09:30:00Z") },
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
    name: `Zapier <script>`,
    groupName: "Family & co",
    canWrite: true,
    expiresAt: new Date("2027-01-02T10:00:00Z"),
  }
  const mail = apiTokenCreatedMail({ webAppUrl: "https://app.example.com" }, input)

  it("names the token, its group, what it can do and when it expires", () => {
    expect(mail.to).toBe("ann@example.com")
    expect(mail.subject).toBe("An API token was created")
    expect(mail.text).toContain(`An API token named "Zapier <script>" was created`)
    expect(mail.text).toContain(
      `It can read and write the group "Family & co" and expires on January 2, 2027.`,
    )
  })

  it("says a read-only token that never expires is just that", () => {
    const readOnly = apiTokenCreatedMail({ webAppUrl: "https://app.example.com" }, {
      ...input,
      canWrite: false,
      expiresAt: null,
    })
    expect(readOnly.text).toContain(`It can read the group "Family & co" and never expires.`)
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
      provider: "Google",
      linked: true,
      at,
    })
    expect(mail.to).toBe("ann@example.com")
    expect(mail.subject).toBe("Google was linked to your account")
    expect(mail.text).toContain(
      "Google was linked to your account at app.example.com on October 15, 2026 at 14:03 UTC.",
    )
    expect(mail.text).toContain("If this wasn't you, unlink Google on your profile page")
    expect(mail.html).toContain(`href="https://app.example.com/"`)
  })

  it("names the unlinked provider and the time, and says to change the password if it was someone else", () => {
    const mail = signInMethodChangedMail(brand, {
      to: "ann@example.com",
      provider: "GitHub",
      linked: false,
      at,
    })
    expect(mail.subject).toBe("GitHub was unlinked from your account")
    expect(mail.text).toContain(
      "GitHub was unlinked from your account at app.example.com on October 15, 2026 at 14:03 UTC.",
    )
    expect(mail.text).toContain(
      "If this wasn't you, sign in, change your password and link GitHub again.",
    )
  })
})

describe("signInMethodChangedMail for a passkey", () => {
  const brand = { webAppUrl: "https://app.example.com" }
  const at = new Date("2026-10-15T14:03:00Z")

  it("says a passkey was added, and to remove it and change the password if it was someone else", () => {
    const mail = signInMethodChangedMail(brand, {
      to: "ann@example.com",
      provider: "A passkey",
      linked: true,
      at,
      passkey: true,
    })
    expect(mail.subject).toBe("A passkey was added to your account")
    expect(mail.text).toContain(
      "A passkey was added to your account at app.example.com on October 15, 2026 at 14:03 UTC.",
    )
    expect(mail.text).toContain(
      "If this wasn't you, remove the passkey on your profile page and change your password.",
    )
    expect(mail.html).toContain(`href="https://app.example.com/"`)
  })

  it("says a passkey was removed, and to add it again if it was someone else", () => {
    const mail = signInMethodChangedMail(brand, {
      to: "ann@example.com",
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
    { to: "ann@example.com", code: "a<b-C9_z", validMinutes: 10 },
  )

  it("carries the code and how long it works in the text and the escaped HTML, with no link", () => {
    expect(mail.to).toBe("ann@example.com")
    expect(mail.text).toContain("\na<b-C9_z\n")
    expect(mail.text).toContain("10 minutes")
    expect(mail.html).toContain("a&lt;b-C9_z")
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
      link,
      groupName: `<b>Team</b> "A"`,
      inviterName: "Ann",
      roleName: "editor",
      validDays: 7,
    },
  )

  it("carries the link, the group, the inviter, the role and how long it works", () => {
    expect(mail.to).toBe("bo@example.com")
    expect(mail.subject).toBe(`Invitation to join "<b>Team</b> "A""`)
    expect(mail.text).toContain(link)
    expect(mail.text).toContain(`Ann invited you to join "<b>Team</b> "A"" at app.example.com`)
    expect(mail.text).toContain("as editor")
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
        link,
        groupName: "Team",
        inviterName: " ",
        roleName: "viewer",
        validDays: 1,
      },
    )
    expect(anonymous.text).toMatch(/^Someone invited you/)
  })
})

describe("billingNoticeMail", () => {
  const brand = { webAppUrl: "https://app.example.com" }
  const link = "https://app.example.com/groups/7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002"
  const mail = (kind: BillingNoticeKind) =>
    billingNoticeMail(brand, {
      to: "ann@example.com",
      kind,
      groupName: "Tea <club>",
      planName: "Pro",
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
      kind: BillingNoticeKind.PaymentFailed,
      groupName: "Tea club",
      planName: "Pro",
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
      kind: BillingNoticeKind.TrialEnding,
      groupName: "Tea club",
      planName: "Pro",
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
