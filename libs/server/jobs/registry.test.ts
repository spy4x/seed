import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type postgres from "postgres"
import { ONE_DAY_IN_MILLISECONDS } from "@spy4x/platform/universal/time-constants"
import { BLOG_PUBLISH_JOB } from "@domain/blog"
import { BILLING_NOTICE_JOBS } from "../billing/billing-notices.ts"
import { SEAT_SYNC_JOB } from "../billing/seat-sync.ts"
import {
  ACCOUNT_DELETION_MAIL_JOB,
  ACCOUNT_HARD_DELETE_JOB,
  ACCOUNT_RESTORED_MAIL_JOB,
} from "./account-deletion.ts"
import { API_TOKEN_CREATED_MAIL_JOB } from "./api-token-mail.ts"
import {
  DATA_EXPORT_BUILD_JOB,
  DATA_EXPORT_EXPIRE_JOB,
  DATA_EXPORT_MAIL_JOB,
} from "./data-export.ts"
import { EMAIL_CODE_MAIL_JOB } from "./email-code-mail.ts"
import { OUTBOX_CLEANUP_JOB } from "./jobs.ts"
import { PASSWORD_RESET_MAIL_JOB } from "./password-reset-mail.ts"
import { SIGN_IN_METHOD_MAIL_JOB } from "./sign-in-method-mail.ts"
import { SIGN_UP_CODE_MAIL_JOB } from "./sign-up-code-mail.ts"
import { SIGN_IN_LINK_MAIL_JOB } from "./sign-in-link-mail.ts"
import { STARTER_DATA_JOB } from "./starter-data.ts"
import { IMAGE_PROCESS_JOB, IMAGE_WIDTHS_JOB } from "../files/images.ts"
import { TELEGRAM_NOTIFICATION_JOB } from "./telegram-notification.ts"
import {
  SUBSCRIBER_CONFIRM_MAIL_JOB,
  SUBSCRIBER_SEND_ISSUE_JOB,
  SUBSCRIBER_WELCOME_MAIL_JOB,
} from "./subscriber-mail.ts"
import { defineJob, describeRepeat, jobLabel, JOBS } from "./registry.ts"
import { createOutboxProcessor, repeatSchedules } from "./wiring.ts"

/** Every kind the product queues today; a new job adds its kind here and an entry to `JOBS`. */
const QUEUED_KINDS = [
  OUTBOX_CLEANUP_JOB,
  SEAT_SYNC_JOB,
  PASSWORD_RESET_MAIL_JOB,
  EMAIL_CODE_MAIL_JOB,
  SIGN_UP_CODE_MAIL_JOB,
  SIGN_IN_LINK_MAIL_JOB,
  SIGN_IN_METHOD_MAIL_JOB,
  API_TOKEN_CREATED_MAIL_JOB,
  ACCOUNT_DELETION_MAIL_JOB,
  ACCOUNT_RESTORED_MAIL_JOB,
  ACCOUNT_HARD_DELETE_JOB,
  STARTER_DATA_JOB,
  IMAGE_PROCESS_JOB,
  IMAGE_WIDTHS_JOB,
  DATA_EXPORT_BUILD_JOB,
  DATA_EXPORT_MAIL_JOB,
  DATA_EXPORT_EXPIRE_JOB,
  TELEGRAM_NOTIFICATION_JOB,
  ...Object.values(BILLING_NOTICE_JOBS),
  SUBSCRIBER_CONFIRM_MAIL_JOB,
  SUBSCRIBER_WELCOME_MAIL_JOB,
  SUBSCRIBER_SEND_ISSUE_JOB,
  BLOG_PUBLISH_JOB,
]

const noop = () => async () => {}

describe(`job registry`, () => {
  it(`registers every kind the product queues, once, each with a label`, () => {
    const kinds = JOBS.map((job) => job.kind)
    expect(new Set(kinds).size).toBe(kinds.length)
    expect([...kinds].sort()).toEqual([...QUEUED_KINDS].sort())
    for (const job of JOBS) expect(job.label.trim()).not.toBe(``)
  })

  it(`marks every job whose kind ends in "-mail" as one that sends mail`, () => {
    for (const job of JOBS) {
      expect({ kind: job.kind, sendsMail: job.sendsMail === true }).toEqual({
        kind: job.kind,
        sendsMail: job.kind.endsWith(`-mail`) || job.kind === SUBSCRIBER_SEND_ISSUE_JOB,
      })
    }
  })

  it(`repeats only the nightly cleanup, every day at 03:00 UTC`, () => {
    expect(repeatSchedules(JOBS)).toEqual({
      repeatEveryMs: {},
      repeatCron: { [OUTBOX_CLEANUP_JOB]: `0 3 * * *` },
    })
  })

  it(`names a kind by its label, and an unknown kind by itself`, () => {
    expect(jobLabel(PASSWORD_RESET_MAIL_JOB)).toBe(`Password reset email`)
    expect(jobLabel(`group.changed`)).toBe(`group.changed`)
  })
})

describe(`defineJob`, () => {
  it(`refuses a kind that is not dotted lowercase words of at most 64 characters`, () => {
    for (const kind of [`cleanup`, `Mail.send`, `a.b c`, `a.${`b`.repeat(63)}`]) {
      expect(() => defineJob({ kind, label: `Job`, handler: noop })).toThrow(RangeError)
    }
    expect(defineJob({ kind: `blog.publish`, label: `Publish`, handler: noop }).kind)
      .toBe(`blog.publish`)
  })

  it(`refuses a blank label, a repeat under a second, a cron it cannot read and a bad table`, () => {
    const base = { kind: `a.b`, handler: noop }
    expect(() => defineJob({ ...base, label: `  ` })).toThrow(`needs a label`)
    expect(() => defineJob({ ...base, label: `Job`, repeat: { everyMs: 999 } })).toThrow(`everyMs`)
    expect(() => defineJob({ ...base, label: `Job`, repeat: { cron: ` ` } })).toThrow(`a.b`)
    expect(() => defineJob({ ...base, label: `Job`, repeat: { cron: `0 24 * * *` } }))
      .toThrow(`hour`)
    expect(defineJob({ ...base, label: `Job`, repeat: { cron: `@weekly` } }).repeat)
      .toEqual({ cron: `@weekly` })
    expect(() => defineJob({ ...base, label: `Job`, about: { userIn: `users; DROP` } }))
      .toThrow(`userIn`)
  })
})

describe(`describeRepeat`, () => {
  it(`says the interval in the largest whole unit`, () => {
    expect(describeRepeat({ everyMs: ONE_DAY_IN_MILLISECONDS })).toBe(`Every day`)
    expect(describeRepeat({ everyMs: 2 * ONE_DAY_IN_MILLISECONDS })).toBe(`Every 2 days`)
    expect(describeRepeat({ everyMs: 3_600_000 })).toBe(`Every hour`)
    expect(describeRepeat({ everyMs: 90 * 60_000 })).toBe(`Every 90 minutes`)
    expect(describeRepeat({ everyMs: 30_000 })).toBe(`Every 30 seconds`)
  })

  it(`says a cron schedule in words`, () => {
    expect(describeRepeat({ cron: `0 3 * * *` })).toBe(`Every day at 03:00 UTC`)
  })
})

describe(`createOutboxProcessor`, () => {
  it(`refuses two jobs of one kind, naming the kind`, () => {
    const job = defineJob({ kind: `reports.daily`, label: `Daily report`, handler: noop })
    const sql = {} as postgres.Sql
    const mail = { store: {} as never, sender: null, brand: { webAppUrl: `` }, log: () => {} }
    expect(() => createOutboxProcessor(sql, mail, null, null, 0, true, null, [job, job]))
      .toThrow(`Two jobs share a kind: reports.daily`)
  })
})
