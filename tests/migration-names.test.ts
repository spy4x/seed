/// <reference lib="deno.ns" />
/**
 * Holds migration file names to the rule in docs/aggregates.md ("Naming a migration"): a new
 * migration sorts after every migration already on `main`.
 *
 * The runner applies files in name order and skips the ones a database has recorded. A new file
 * that sorts before an applied one therefore runs late on a developer's database and early on an
 * empty one, where the tables it changes do not exist yet (spy4x/template#351). The date in a name
 * is a counter, not the calendar: the names already run ahead of it.
 *
 * `ON_MAIN` is how this test knows what is on `main` without the network. Each pull request that
 * adds a migration appends its file name as the last line, and changes no other line. The test
 * cannot tell an appended line from an inserted one: a name put into the middle of the list, or a
 * file renamed or deleted together with its line, stays green. A reviewer reads the diff of the
 * list for that.
 */

import { expect } from "@std/expect"
import { fromFileUrl } from "@std/path"

const MIGRATIONS_DIR = fromFileUrl(new URL("../libs/server/db/migrations", import.meta.url))

/** Every migration on `main`, oldest first. Append only: never insert, reorder, rename or remove. */
const ON_MAIN: readonly string[] = [
  "2026_01_26_0001_init.sql",
  "2026_01_26_0002_auth_profiles_audit.sql",
  "2026_01_27_0001_drop_user_profiles.sql",
  "2026_08_18_0001_group_core.sql",
  "2026_08_18_0002_personal_group_backfill.sql",
  "2026_09_24_0001_auth_package_tables.sql",
  "2026_09_30_0001_push_token_one_per_device.sql",
  "2026_09_30_0002_totp_failure_counter.sql",
  "2026_10_01_0001_idempotency_keys.sql",
  "2026_10_02_0001_notes.sql",
  "2026_10_03_0001_idempotency_claim_token.sql",
  "2026_10_03_0002_outbox_jobs.sql",
  "2026_10_04_0001_groups_ms_precision.sql",
  "2026_10_05_0001_user_settings.sql",
  "2026_10_06_0001_password_reset.sql",
  "2026_10_07_0001_group_kind_removed.sql",
  "2026_10_08_0001_audit_outlives_group.sql",
  "2026_10_08_0002_email_verification.sql",
  "2026_10_09_0001_audit_request_id_128.sql",
  "2026_10_10_0001_auth_audit_identifier_320.sql",
  "2026_10_11_0001_billing.sql",
  "2026_10_12_0001_billing_grace_period.sql",
  "2026_10_12_0002_group_invitations.sql",
  "2026_10_13_0001_billing_trial_end.sql",
  "2026_10_13_0002_group_single_owner.sql",
  "2026_10_14_0001_subscription_quantity.sql",
  "2026_10_15_0001_subscription_ever_active.sql",
  "2026_10_16_0001_billing_handover.sql",
  "2026_10_17_0001_subscribers.sql",
  "2026_10_18_0001_group_appearance.sql",
  "2026_10_19_0001_audit_activity.sql",
  "2026_10_20_0001_account_deletion.sql",
  "2026_10_22_0001_notifications.sql",
  "2026_10_23_0001_notes_deleted_indexes.sql",
  "2026_10_23_0002_auth_session_devices.sql",
  "2026_10_24_0001_users_last_seen.sql",
  "2026_10_25_0001_api_tokens.sql",
  "2026_10_26_0001_starter_data.sql",
  "2026_10_27_0001_tags.sql",
  "2026_10_28_0001_api_tokens_purged_audit.sql",
  "2026_10_29_0001_idempotency_claim_token_no_default.sql",
  "2026_10_30_0001_api_token_hardening.sql",
  "2026_11_01_0001_close_given_up_outbox_rows.sql",
  "2026_11_02_0001_push_endpoint_2048.sql",
  "2026_11_03_0001_users_onboarding.sql",
  "2026_11_04_0001_sign_in_method_audit.sql",
  "2026_11_05_0001_password_failures.sql",
  "2026_11_06_0001_notifications_unread_purge.sql",
  "2026_11_07_0001_sign_in_method_changes.sql",
  "2026_11_08_0001_users_blocked.sql",
  "2026_11_09_0001_admin_stats_indexes.sql",
  "2026_11_12_0001_push_device_removed_audit.sql",
  "2026_11_13_0001_newsletter_admin_audit.sql",
  "2026_11_13_0002_admin_user_actions.sql",
  "2026_11_14_0001_backup_status.sql",
  "2026_11_16_0001_admin_billing.sql",
  "2026_11_17_0001_sign_up_requests.sql",
  "2026_11_18_0001_auth_audits_ip_index.no_transaction.sql",
  "2026_11_18_0002_auth_audits_operator_index.no_transaction.sql",
  "2026_11_18_0003_users_created_at_index.no_transaction.sql",
  "2026_11_18_0004_users_last_seen_at_index.no_transaction.sql",
  "2026_11_18_0005_users_blocked_index.no_transaction.sql",
  "2026_11_20_0001_user_preferences.sql",
  "2026_11_21_0001_password_check_failures.sql",
  "2026_11_22_0001_note_search.sql",
  "2026_11_23_0001_users_trial.sql",
  "2026_11_24_0001_groups_imported_at.sql",
  "2026_11_25_0001_auth_passkeys.sql",
  "2026_11_26_0001_guest_accounts.sql",
  "2026_11_27_0001_hex_colours.sql",
  "2026_11_28_0001_outbox_cancelled_at.sql",
  "2026_11_29_0001_sign_in_links.sql",
  "2026_11_30_0001_blog_posts.sql",
  "2026_12_01_0001_data_exports.sql",
  "2026_12_04_0001_telegram.sql",
  "2026_12_04_0002_note_attachments.sql",
  "2026_12_05_0001_profile_pictures.sql",
]

// `.no_transaction.sql` is the runner's ending for a statement that cannot run in a transaction.
const NAME = /^\d{4}_\d{2}_\d{2}_\d{4}_[a-z0-9]+(_[a-z0-9]+)*(\.no_transaction)?\.sql$/

/**
 * What is wrong with the migration files `inTree`, given the names `onMain` in the order they were
 * added. One sentence per problem; empty when the names follow the rule.
 */
export function nameProblems(inTree: readonly string[], onMain: readonly string[]): string[] {
  const problems: string[] = []
  const newest = onMain.at(-1) ?? ""
  for (let i = 1; i < onMain.length; i++) {
    if (!(onMain[i - 1] < onMain[i])) {
      problems.push(`ON_MAIN: ${onMain[i]} is listed after ${onMain[i - 1]} but sorts before it.`)
    }
  }
  for (const name of onMain) {
    if (!inTree.includes(name)) {
      problems.push(`${name} is on main but has no file: a migration is never renamed or deleted.`)
    }
  }
  for (const name of [...inTree].sort()) {
    if (!NAME.test(name)) {
      problems.push(
        `${name} is not named YYYY_MM_DD_NNNN_words_in_snake_case.sql or .no_transaction.sql.`,
      )
    } else if (onMain.includes(name)) {
      continue
    } else if (name < newest) {
      problems.push(
        `${name} sorts before ${newest}, the newest migration on main: rename it to sort after.`,
      )
    } else {
      problems.push(`${name} is new: append it as the last line of ON_MAIN in this test.`)
    }
  }
  return problems
}

Deno.test("every migration file is listed, and none sorts before the newest one on main", () => {
  const inTree = [...Deno.readDirSync(MIGRATIONS_DIR)].map((entry) => entry.name)
  expect(inTree.length).toBeGreaterThan(0)
  expect(nameProblems(inTree, ON_MAIN)).toEqual([])
})

const A = "2026_10_27_0001_tags.sql"
const B = "2026_10_28_0001_api_tokens_purged_audit.sql"

Deno.test("a new migration that sorts before the newest one on main is refused", () => {
  // Today's date, while the names on main already run ahead of the calendar.
  expect(nameProblems([A, B, "2026_10_12_0003_probe.sql"], [A, B])).toEqual([
    `2026_10_12_0003_probe.sql sorts before ${B}, the newest migration on main: rename it to sort after.`,
  ])
  // Between the two newest is still before the newest.
  expect(nameProblems([A, B, "2026_10_27_0002_probe.sql"], [A, B])).toHaveLength(1)
})

Deno.test("a new migration that sorts after the newest one passes once it is appended", () => {
  const next = "2026_10_30_0001_api_token_hardening.sql"
  const sameDay = "2026_10_28_0002_probe.no_transaction.sql"
  expect(nameProblems([A, B, next], [A, B])).toEqual([
    `${next} is new: append it as the last line of ON_MAIN in this test.`,
  ])
  expect(nameProblems([A, B, next], [A, B, next])).toEqual([])
  expect(nameProblems([A, B, sameDay], [A, B, sameDay])).toEqual([])
})

Deno.test("a list that is out of order, or names a file that is gone, is refused", () => {
  expect(nameProblems([A, B], [B, A])).toEqual([
    `ON_MAIN: ${A} is listed after ${B} but sorts before it.`,
  ])
  expect(nameProblems([B], [A, B])).toEqual([
    `${A} is on main but has no file: a migration is never renamed or deleted.`,
  ])
})

Deno.test("a name outside the pattern is refused", () => {
  for (
    const name of [
      "2026_10_29_1_probe.sql",
      "2026-10-29-0001-probe.sql",
      "2026_10_29_0001_Probe.sql",
    ]
  ) {
    expect(nameProblems([A, name], [A])).toEqual([
      `${name} is not named YYYY_MM_DD_NNNN_words_in_snake_case.sql or .no_transaction.sql.`,
    ])
  }
})
