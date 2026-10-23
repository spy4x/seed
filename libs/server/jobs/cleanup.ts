import type postgres from "postgres"
import { type JobStep, PostgresOutboxRepository } from "@spy4x/server/outbox"
import type { BillingProvider } from "@spy4x/billing"
import { cleanUpAttachments } from "../notes/attachment-cleanup.ts"
import { queueSeatDrift } from "../billing/seat-sync.ts"
import { purgeDeadInvitations } from "../groups/purge-dead-invitations.ts"
import { purgeDeletedNotes } from "../notes/purge-deleted-notes.ts"
import { purgeDeletedGroups } from "../groups/purge-deleted-groups.ts"
import { purgeNotifications } from "../notifications/purge-notifications.ts"
import { purgeOldAuditEvents } from "../groups/purge-audit-events.ts"
import { purgeExpiredApiTokens } from "../api-tokens/purge-expired-api-tokens.ts"
import { hardDeleteDueAccounts } from "../auth/account-deletion.ts"
import { cleanUpGuests } from "../auth/guests.ts"
import { removeStaleEmailCodeRequests } from "./email-code-mail.ts"
import { removeExpiredAuthChallenges } from "./auth-challenges.ts"
import { removeExpiredSignUps } from "./sign-up-code-mail.ts"
import { removeStaleSignInLinkRequests } from "./sign-in-link-mail.ts"
import { removeStalePasswordResetRequests } from "./password-reset-mail.ts"
import { removeStaleSubscriptionRequests } from "./subscriber-mail.ts"
import { removeStaleTelegramMessages } from "./telegram-notification.ts"
import { OUTBOX_RETENTION_DAYS } from "./jobs.ts"
import type { ServerFiles } from "../files/files.ts"
import { removeExpiredDataExports } from "./data-export.ts"

/**
 * The parts of the nightly cleanup, in the order they run. Each removes only what is due, so one
 * that ran again finds nothing.
 */
export function cleanupSteps(
  sql: postgres.Sql,
  provider: BillingProvider | null,
  log: (line: string) => void,
  files: ServerFiles | null = null,
): JobStep[] {
  return [
    ["remove old processed outbox rows", async () => {
      const removed = await new PostgresOutboxRepository(sql).removeProcessed(OUTBOX_RETENTION_DAYS)
      if (removed > 0) console.log(`Removed ${removed} old processed outbox row(s)`)
    }],
    ["remove unsent password reset requests", async () => {
      const stale = await removeStalePasswordResetRequests(sql)
      if (stale > 0) console.log(`Removed ${stale} unsent password reset request(s)`)
    }],
    ["remove unsent e-mail code requests", async () => {
      const staleCodes = await removeStaleEmailCodeRequests(sql)
      if (staleCodes > 0) console.log(`Removed ${staleCodes} unsent e-mail code request(s)`)
    }],
    ["remove unused sign-in links", async () => {
      const links = await removeStaleSignInLinkRequests(sql)
      if (links > 0) console.log(`Removed ${links} unused sign-in link request(s)`)
    }],
    ["remove unsent Telegram messages", async () => {
      const messages = await removeStaleTelegramMessages(sql)
      if (messages > 0) console.log(`Removed ${messages} unsent Telegram message(s)`)
    }],
    ["remove expired sign-ups", async () => {
      const signUps = await removeExpiredSignUps(sql)
      if (signUps > 0) console.log(`Removed ${signUps} expired sign-up(s)`)
    }],
    // Guest accounts (#224): empty ones a week on, and any unused for a year.
    ["remove empty and idle guest accounts", async () => {
      const guests = await cleanUpGuests(sql)
      if (guests > 0) console.log(`Removed ${guests} empty or idle guest account(s)`)
    }],
    ["remove expired codes", async () => {
      const codes = await removeExpiredAuthChallenges(sql)
      if (codes > 0) console.log(`Removed ${codes} expired code(s)`)
    }],
    ["remove unsent subscription requests", async () => {
      const staleSubs = await removeStaleSubscriptionRequests(sql)
      if (staleSubs > 0) console.log(`Removed ${staleSubs} unsent subscription request(s)`)
    }],
    ["purge deleted groups", async () => {
      const groups = await purgeDeletedGroups(sql)
      if (groups.removed > 0) console.log(`Removed ${groups.removed} deleted group(s) for good`)
      if (groups.kept > 0) {
        console.warn(
          `Kept ${groups.kept} deleted group(s) with a live subscription; cancel it in Stripe`,
        )
      }
    }],
    ["purge deleted notes", async () => {
      const notes = await purgeDeletedNotes(sql)
      if (notes.removed > 0) console.log(`Removed ${notes.removed} deleted note(s) for good`)
    }],
    // After the purges above, so the files of notes and groups they removed go tonight.
    ["clean up note attachments", async () => {
      if (!files) return
      const done = await cleanUpAttachments(sql, files)
      if (done.uploads + done.staging + done.deleted > 0) {
        console.log(
          `Forgot ${done.uploads} unconfirmed upload(s), deleted ${done.staging} staging ` +
            `object(s) and ${done.deleted} removed file(s)`,
        )
      }
    }],
    ["purge dead invitations", async () => {
      const invitations = await purgeDeadInvitations(sql)
      if (invitations > 0) console.log(`Removed ${invitations} dead group invitation(s)`)
    }],
    ["purge expired API tokens", async () => {
      const tokens = await purgeExpiredApiTokens(sql)
      if (tokens > 0) console.log(`Removed ${tokens} expired or revoked API token(s) for good`)
    }],
    ["purge old audit events", async () => {
      const audit = await purgeOldAuditEvents(sql)
      if (audit > 0) console.log(`Removed ${audit} audit event(s) past their retention`)
    }],
    ["purge old notifications", async () => {
      const inbox = await purgeNotifications(sql)
      if (inbox > 0) console.log(`Removed ${inbox} notification(s) past their retention`)
    }],
    ["delete accounts whose wait is over", async () => {
      const accounts = await hardDeleteDueAccounts(sql, log)
      if (accounts.deleted > 0) console.log(`Deleted ${accounts.deleted} account(s) for good`)
      if (accounts.blocked > 0) {
        console.warn(
          `Kept ${accounts.blocked} account(s) due for deletion: a shared or paid group`,
        )
      }
      if (accounts.failed > 0) {
        throw new Error(`${accounts.failed} account(s) due for deletion were not deleted`)
      }
    }],
    ["delete data export files past their days", async () => {
      const removed = await removeExpiredDataExports(sql, files)
      if (removed > 0) console.log(`Deleted ${removed} data export file(s) a lost job left`)
    }],
    ["queue seat syncs for drifted groups", async () => {
      if (!provider) return
      const drifted = await queueSeatDrift(sql)
      if (drifted > 0) console.log(`Queued a seat sync for ${drifted} group(s)`)
    }],
  ]
}
