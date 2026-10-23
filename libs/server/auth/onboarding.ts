/**
 * The first-steps checklist and the tour of the SPA (#298): what a person has already done, read
 * from the tables that hold it, and the two answers kept on their `users` row.
 *
 * Reads no environment and imports no singleton.
 *
 * @module
 */

import type postgres from "postgres"
import { PASSWORD_METHOD } from "@spy4x/server/auth/password"
import {
  type OnboardingMark,
  type OnboardingStatus,
  SIGN_IN_LINK_METHOD,
  UserMFAStatus,
} from "@domain/identity"

interface OnboardingRow extends postgres.Row {
  emailVerified: boolean
  noteCreated: boolean
  memberInvited: boolean
  notificationsOn: boolean
  twoFactorOn: boolean
  dismissed: boolean
  tourSeen: boolean
}

/**
 * What `userId` has done of the first steps, and whether they closed the checklist or the tour.
 * `null` for a person who does not exist or is deleted.
 *
 * Each step is a fact another feature already keeps, so nothing has to remember to tick it:
 *
 * - the address: the password key, or the key of a sign-up by link, carries an address that a code
 *   or the link proved;
 * - a note: the person created one. The welcome note of a new account
 *   (`@server/jobs/starter-data.ts`) is created in their name and does not count: its id is the id
 *   of their `starter_data_requests` row. A note in the trash still counts, so deleting the first
 *   note does not untick the step;
 * - an invitation: the person made one, whatever became of it;
 * - notifications: one of their browsers is registered for push;
 * - two-factor: an authenticator app is set up.
 */
export async function readOnboarding(
  sql: postgres.Sql,
  userId: number,
): Promise<OnboardingStatus | null> {
  const [row] = await sql<OnboardingRow[]>`
    SELECT
      EXISTS (
        SELECT 1 FROM auth_keys
        WHERE auth_keys.user_id = users.id
          AND auth_keys.method IN (${PASSWORD_METHOD}, ${SIGN_IN_LINK_METHOD})
          AND auth_keys.email IS NOT NULL
          AND auth_keys.proven_at IS NOT NULL
      ) AS "emailVerified",
      EXISTS (
        SELECT 1 FROM notes
        WHERE notes.created_by_user_id = users.id
          AND NOT EXISTS (
            SELECT 1 FROM starter_data_requests
            WHERE starter_data_requests.id = notes.id
          )
      ) AS "noteCreated",
      EXISTS (
        SELECT 1 FROM group_invitations
        WHERE group_invitations.created_by_user_id = users.id
      ) AS "memberInvited",
      EXISTS (
        SELECT 1 FROM user_push_tokens
        WHERE user_push_tokens.user_id = users.id
          AND user_push_tokens.deleted_at IS NULL
      ) AS "notificationsOn",
      users.mfa = ${UserMFAStatus.CONFIGURED} AS "twoFactorOn",
      users.onboarding_dismissed_at IS NOT NULL AS "dismissed",
      users.onboarding_tour_seen_at IS NOT NULL AS "tourSeen"
    FROM users
    WHERE users.id = ${userId}
      AND users.deleted_at IS NULL
  `
  if (!row) return null
  const { dismissed, tourSeen, ...steps } = row
  return { steps, dismissed, tourSeen }
}

/**
 * Records that `userId` closed the checklist (`dismissed`) or finished or skipped the tour
 * (`tourSeen`). The first time is kept: a second call changes nothing, so a retry is harmless.
 */
export async function markOnboarding(
  sql: postgres.Sql,
  userId: number,
  mark: OnboardingMark,
): Promise<void> {
  if (mark === "dismissed") {
    await sql`
      UPDATE users SET onboarding_dismissed_at = now()
      WHERE id = ${userId} AND onboarding_dismissed_at IS NULL
    `
  } else {
    await sql`
      UPDATE users SET onboarding_tour_seen_at = now()
      WHERE id = ${userId} AND onboarding_tour_seen_at IS NULL
    `
  }
}
