import type postgres from "postgres"
import { encodeBase32 } from "@std/encoding/base32"
import { deviceName } from "@spy4x/net/user-agent"
import { ipHint } from "@spy4x/net/ip"
import { randomBase64Url, sha256Hex } from "@spy4x/platform/tokens"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { PASSWORD_METHOD } from "@spy4x/server/auth/password"
import { SecondFactorStatus, SessionStatus } from "@spy4x/server/sign-in"
import {
  BILLING_AUDIT_EVENTS,
  billingAuditIdentifier,
  BillingStatus,
  PRO_PLAN_ID,
} from "@domain/billing"
import { AuthAuditEventType, SIGN_IN_LINK_METHOD } from "@domain/identity"
import { PASSKEY_METHOD, passkeyIdentifier } from "@server/auth/passkeys.ts"
import { DEFAULT_SUBSCRIBER_LIST } from "@domain/subscribers"
import { BACKUP_TARGET_DATABASE } from "@server/jobs/admin-system.ts"
import { WELCOME_NOTE_BODY, WELCOME_NOTE_TITLE } from "@server/jobs/starter-data.ts"
import { PostgresNoteRepository } from "@server/notes/postgres-note-repository.ts"
import { createListCrypto, type SubscribersSetup } from "@server/subscribers/subscribers.ts"
import { operatorIdentifier } from "../../api/services/admin.ts"
import { DAY, type FakeDemoData, type FakeUser, HOUR } from "./fake-data.ts"

/**
 * The history the demo's seed writes after its accounts and groups exist (docs/demo.md): when each
 * person joined and signed in, from which browser, their open sessions and second factors, the
 * groups' subscriptions and the provider's events, the newsletter's sends, and what an operator
 * did. Raw SQL, because nothing in the app writes the past: each row is what the app's own code
 * would have written at that time. Nothing here calls a provider or mails anyone.
 */

/** Turns minutes before `now` into a date. */
export type At = (ago: number) => Date

/** How long a seeded session stays signed in. */
const SESSION_DAYS = 30

/** How many rows one insert carries. */
const CHUNK = 500

/** An `auth_audits` row with its time. */
interface AuditRow {
  userId: number
  eventType: number
  identifier: string | null
  ip: string | null
  userAgent: string | null
  createdAt: Date
  updatedAt: Date
}

async function insertAudits(sql: postgres.Sql, rows: AuditRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await sql`INSERT INTO auth_audits ${sql(rows.slice(i, i + CHUNK))}`
  }
}

function audit(
  userId: number,
  eventType: number,
  createdAt: Date,
  identifier: string | null = null,
  device: { userAgent: string; ip: string } | null = null,
): AuditRow {
  return {
    userId,
    eventType,
    identifier,
    ip: device?.ip ?? null,
    userAgent: device?.userAgent ?? null,
    createdAt,
    updatedAt: createdAt,
  }
}

/** A new account and when, and from where, it signed up. */
export interface Joined {
  userId: number
  joined: Date
  device: { userAgent: string; ip: string } | null
}

/**
 * Moves new accounts' sign-ups to when they joined: each account, its keys, its sign-up row, its
 * first group with that group's audit rows, and its starter data. The welcome note the starter-data
 * job would write is written here first, under the job's own id, then dated with the rest; the
 * request is closed, so the job adds nothing later. One statement per table for all of them. Run
 * before the accounts are in any other group.
 */
export async function backdateAccounts(
  sql: postgres.Sql,
  accounts: readonly Joined[],
): Promise<void> {
  const requests = await sql<{ id: string; userId: number; groupId: string }[]>`
    SELECT r.id, r.user_id, m.group_id FROM starter_data_requests r
    JOIN group_members m ON m.user_id = r.user_id
    WHERE r.done_at IS NULL AND r.user_id IN ${sql(accounts.map((a) => a.userId))}
  `
  const notes = new PostgresNoteRepository(sql)
  for (const request of requests) {
    const welcome = { id: request.id, groupId: request.groupId }
    await notes.create(
      { ...welcome, title: WELCOME_NOTE_TITLE, body: WELCOME_NOTE_BODY },
      request.userId,
      null,
    )
  }
  const rows = sql.json(accounts.map((account) => ({
    user_id: account.userId,
    joined: account.joined.toISOString(),
    user_agent: account.device?.userAgent ?? null,
    ip: account.device?.ip ?? null,
  })))
  const v = sql`
    jsonb_to_recordset(${rows}::jsonb) AS v(user_id int, joined timestamptz, user_agent text, ip text)
  `
  await sql`UPDATE auth_users a SET created_at = v.joined FROM ${v} WHERE a.id = v.user_id`
  await sql`
    UPDATE users u SET created_at = v.joined, updated_at = v.joined FROM ${v} WHERE u.id = v.user_id
  `
  await sql`
    UPDATE auth_keys k SET created_at = v.joined, updated_at = v.joined,
      proven_at = CASE WHEN k.proven_at IS NULL THEN NULL ELSE v.joined END
    FROM ${v} WHERE k.user_id = v.user_id
  `
  await sql`
    UPDATE auth_audits a SET created_at = v.joined, updated_at = v.joined, ip = v.ip,
      user_agent = v.user_agent
    FROM ${v} WHERE a.user_id = v.user_id AND a.event_type = ${AuthAuditEventType.SIGNED_UP}
  `
  await sql`
    UPDATE groups g SET created_at = v.joined, updated_at = v.joined
    FROM ${v} JOIN group_members m ON m.user_id = v.user_id
    WHERE g.id = m.group_id
  `
  await sql`
    UPDATE group_members m SET created_at = v.joined, updated_at = v.joined
    FROM ${v} WHERE m.user_id = v.user_id
  `
  await sql`
    UPDATE audit_events e SET created_at = v.joined FROM ${v} WHERE e.actor_user_id = v.user_id
  `
  await sql`
    UPDATE starter_data_requests r SET created_at = v.joined, done_at = v.joined
    FROM ${v} WHERE r.user_id = v.user_id
  `
  await sql`
    UPDATE notes n SET created_at = r.done_at, updated_at = r.done_at
    FROM ${v} JOIN starter_data_requests r ON r.user_id = v.user_id
    WHERE n.id = r.id
  `
}

/**
 * Each person's past: sign-up time, sign-ins with their browsers and addresses, open sessions, a
 * Google or GitHub key, a second factor, a block, a changed name, and when they were last seen.
 * `ids` are the people's user ids, in the order of `users`.
 */
export async function writePeople(
  sql: postgres.Sql,
  users: readonly FakeUser[],
  ids: readonly number[],
  at: At,
  now: Date,
): Promise<void> {
  await backdateAccounts(
    sql,
    users.map((user, i) => ({
      userId: ids[i],
      joined: at(user.joinedAgo),
      device: user.devices[0],
    })),
  )
  const keys = await sql<{ userId: number; id: number }[]>`
    SELECT user_id, id FROM auth_keys WHERE method = ${PASSWORD_METHOD} AND user_id IN ${sql(ids)}
  `
  const keyOf = new Map(keys.map((key) => [key.userId, key.id]))
  const audits: AuditRow[] = []
  const profiles = []
  const providerKeys = []
  const passkeys: { userId: number; name: string; added: Date; lastUsed: Date | null }[] = []
  const factors = []
  const sessions = []
  for (const [i, user] of users.entries()) {
    const id = ids[i]
    const latest = Math.min(
      user.joinedAgo,
      ...user.signIns.map((signIn) => signIn.ago),
      ...user.sessions.map((session) => session.lastUsedAgo),
    )
    const lastSignIn = Math.min(user.joinedAgo, ...user.signIns.map((signIn) => signIn.ago))
    profiles.push({
      id,
      last_seen_at: at(latest).toISOString(),
      last_login_at: at(lastSignIn).toISOString(),
      updated_at: at(user.profileUpdatedAgo ?? user.joinedAgo).toISOString(),
      mfa: user.secondFactor ? 3 : 1,
      blocked_at: user.blockedAgo === null ? null : at(user.blockedAgo).toISOString(),
      first_group_name: user.firstGroupName,
    })
    // Someone without Google or GitHub asks for a sign-in link now and then (#391).
    const linkSignIns = user.provider ? [] : user.signIns.filter((_, n) => n % 3 === 1)
    for (const [n, signIn] of user.signIns.entries()) {
      // Someone with Google or GitHub uses it for every other sign-in.
      const method = user.provider && signIn.ago < user.providerAgo && n % 2 === 0
        ? user.provider
        : linkSignIns.includes(signIn)
        ? SIGN_IN_LINK_METHOD
        : null
      audits.push(
        audit(
          id,
          AuthAuditEventType.SIGNED_IN,
          at(signIn.ago),
          method,
          user.devices[signIn.device],
        ),
      )
    }
    if (user.profileUpdatedAgo !== null) {
      audits.push(
        audit(
          id,
          AuthAuditEventType.PROFILE_UPDATED,
          at(user.profileUpdatedAgo),
          null,
          user.devices[0],
        ),
      )
    }
    if (linkSignIns.length > 0) {
      // The key link sessions run on, made by the first link the person used. No secret, no address.
      const first = at(Math.max(...linkSignIns.map((signIn) => signIn.ago)))
      providerKeys.push({
        userId: id,
        method: SIGN_IN_LINK_METHOD,
        subject: uuidV7(),
        email: null,
        provenAt: null,
        createdAt: first,
        updatedAt: first,
      })
    }
    if (user.provider) {
      const linked = at(user.providerAgo)
      // A fake account id at the provider, so nobody's real Google or GitHub account matches.
      providerKeys.push({
        userId: id,
        method: user.provider,
        subject: `fake-${uuidV7()}`,
        email: user.email,
        provenAt: linked,
        createdAt: linked,
        updatedAt: linked,
      })
      if (user.providerAgo < user.joinedAgo) {
        audits.push(
          audit(
            id,
            AuthAuditEventType.SIGN_IN_METHOD_LINKED,
            linked,
            user.provider,
            user.devices[0],
          ),
        )
      }
    }
    if (user.passkey) {
      const added = at(user.passkey.addedAgo)
      const device = user.devices[user.passkey.device]
      const name = deviceName(device.userAgent) || `Passkey`
      passkeys.push({
        userId: id,
        name,
        added,
        lastUsed: user.passkey.lastUsedAgo === null ? null : at(user.passkey.lastUsedAgo),
      })
      audits.push(
        audit(id, AuthAuditEventType.SIGN_IN_METHOD_LINKED, added, passkeyIdentifier(name), device),
      )
    }
    if (user.secondFactor) {
      const enrolled = at(Math.max(user.joinedAgo - HOUR, 0))
      factors.push({
        userId: id,
        // A random secret nobody holds: nobody can produce its codes.
        secret: encodeBase32(crypto.getRandomValues(new Uint8Array(20))).replaceAll(`=`, ``),
        confirmedAt: enrolled,
        createdAt: enrolled,
        updatedAt: enrolled,
      })
    }
    for (const session of user.sessions) {
      const device = user.devices[session.device]
      sessions.push({
        userId: id,
        keyId: keyOf.get(id)!,
        // Nobody holds the token.
        tokenHash: await sha256Hex(randomBase64Url(32)),
        status: SessionStatus.Active,
        secondFactor: user.secondFactor
          ? SecondFactorStatus.Completed
          : SecondFactorStatus.NotRequired,
        expiresAt: new Date(now.getTime() + SESSION_DAYS * DAY * 60_000),
        createdAt: at(session.createdAgo),
        deviceName: deviceName(device.userAgent),
        ipHint: ipHint(device.ip),
        lastUsedAt: at(session.lastUsedAgo),
      })
    }
  }
  await sql`
    UPDATE users u SET last_seen_at = v.last_seen_at, last_login_at = v.last_login_at,
      updated_at = v.updated_at, mfa = v.mfa, blocked_at = v.blocked_at
    FROM jsonb_to_recordset(${sql.json(profiles)}::jsonb) AS v(
      id int, last_seen_at timestamptz, last_login_at timestamptz, updated_at timestamptz,
      mfa int2, blocked_at timestamptz
    )
    WHERE u.id = v.id
  `
  // Their first group is the only one they are in so far.
  await sql`
    UPDATE groups g SET name = v.first_group_name
    FROM jsonb_to_recordset(${sql.json(profiles)}::jsonb) AS v(id int, first_group_name text)
    JOIN group_members m ON m.user_id = v.id
    WHERE g.id = m.group_id AND v.first_group_name IS NOT NULL
  `
  await writeOwnNotes(sql, users, ids, at)
  if (providerKeys.length > 0) await sql`INSERT INTO auth_keys ${sql(providerKeys)}`
  await writePasskeys(sql, passkeys)
  if (factors.length > 0) await sql`INSERT INTO user_totp ${sql(factors)}`
  if (sessions.length > 0) await sql`INSERT INTO auth_sessions ${sql(sessions)}`
  await insertAudits(sql, audits)
}

/**
 * The fake people's passkeys (#222): a key of method `passkey` and its `auth_passkeys` row each.
 * The credential id is marked as fake and the public key is random bytes, which no device holds a
 * private key for: nobody can sign in with one.
 */
async function writePasskeys(
  sql: postgres.Sql,
  passkeys: readonly { userId: number; name: string; added: Date; lastUsed: Date | null }[],
): Promise<void> {
  if (passkeys.length === 0) return
  const keys = await sql<{ id: number; userId: number }[]>`
    INSERT INTO auth_keys ${
    sql(passkeys.map((passkey) => ({
      userId: passkey.userId,
      method: PASSKEY_METHOD,
      subject: `fake-${uuidV7()}`,
      email: null,
      provenAt: null,
      createdAt: passkey.added,
      updatedAt: passkey.added,
    })))
  }
    RETURNING id, user_id
  `
  // One passkey per person, so the owner finds the key.
  const keyOf = new Map(keys.map((key) => [key.userId, key.id]))
  await sql`
    INSERT INTO auth_passkeys ${
    sql(passkeys.map((passkey) => ({
      keyId: keyOf.get(passkey.userId)!,
      userId: passkey.userId,
      publicKey: crypto.getRandomValues(new Uint8Array(77)),
      name: passkey.name,
      lastUsedAt: passkey.lastUsed,
    })))
  }
  `
}

/** The provider ids of one seeded subscription, for the operator's audit rows. */
export interface SeededSubscription {
  groupId: string
  subscriptionId: string
}

/** A provider id clearly marked as fake, in the provider's own shape. */
function fakeProviderId(prefix: string): string {
  return `${prefix}_fake${uuidV7().replaceAll(`-`, ``).slice(-14)}`
}

/**
 * The groups' subscriptions and customers as the provider's webhooks would have stored them, with
 * one stored event per payment, so the admin's billing figures and "last event" are real counts.
 * Only rows in this app's tables: no provider is called.
 */
export async function writeBilling(
  sql: postgres.Sql,
  data: FakeDemoData,
  groupIds: readonly (string | null)[],
  at: At,
): Promise<(SeededSubscription | null)[]> {
  const seeded: (SeededSubscription | null)[] = []
  const events: { id: string; eventType: number; receivedAt: Date }[] = []
  const event = (eventType: number, ago: number) =>
    events.push({ id: fakeProviderId(`evt`), eventType, receivedAt: at(ago) })
  for (const subscription of data.subscriptions) {
    const groupId = groupIds[subscription.group]
    if (!groupId) {
      seeded.push(null)
      continue
    }
    const customerId = fakeProviderId(`cus`)
    const subscriptionId = fakeProviderId(`sub`)
    const since = at(subscription.customerSinceAgo)
    const ahead = (minutes: number) => at(-minutes)
    event(1, subscription.customerSinceAgo)
    for (const ago of subscription.paymentsAgo) event(4, ago)
    let lastAgo = Math.min(subscription.customerSinceAgo, ...subscription.paymentsAgo)
    let rank = subscription.paymentsAgo.length > 0 ? 2 : 1
    if (subscription.pastDueSinceAgo !== null) {
      event(5, subscription.pastDueSinceAgo)
      lastAgo = subscription.pastDueSinceAgo
      rank = 2
    }
    if (subscription.status === BillingStatus.Canceled) {
      lastAgo = -subscription.periodEndIn
      event(3, lastAgo)
      rank = 3
    }
    if (subscription.cancelAtPeriodEnd) {
      lastAgo = Math.max(HOUR, Math.floor(lastAgo / 2))
      event(2, lastAgo)
      rank = 2
    }
    await sql`
      INSERT INTO billing_customers (group_id, provider_customer_id, created_at)
      VALUES (${groupId}, ${customerId}, ${since})
    `
    await sql`
      INSERT INTO subscriptions (
        group_id, provider_subscription_id, plan_id, status, current_period_end,
        cancel_at_period_end, provider_event_at, provider_event_rank, updated_at, past_due_since,
        trial_end, quantity, ever_active, provider_customer_id
      ) VALUES (
        ${groupId}, ${subscriptionId}, ${PRO_PLAN_ID}, ${subscription.status},
        ${ahead(subscription.periodEndIn)}, ${subscription.cancelAtPeriodEnd}, ${at(lastAgo)},
        ${rank}, ${at(lastAgo)},
        ${subscription.pastDueSinceAgo === null ? null : at(subscription.pastDueSinceAgo)},
        ${subscription.trialEndIn === null ? null : ahead(subscription.trialEndIn)},
        ${subscription.seats}, ${subscription.everActive}, ${customerId}
      )
    `
    if (subscription.status === BillingStatus.Trialing) {
      await sql`
        UPDATE users SET trial_group_id = ${groupId}, trial_used_at = ${since}
        WHERE id = (SELECT owner_user_id FROM groups WHERE id = ${groupId})
      `
    }
    seeded.push({ groupId, subscriptionId })
  }
  if (events.length > 0) await sql`INSERT INTO billing_events ${sql(events)}`
  return seeded
}

/**
 * The newsletter list, keyed as the subscribe flow keys it, the addresses that left it, and the
 * send log of each issue: who it went to then, by the keyed marks the log keeps.
 */
export async function writeNewsletter(
  sql: postgres.Sql,
  data: FakeDemoData,
  setup: SubscribersSetup,
  at: At,
): Promise<void> {
  const list = DEFAULT_SUBSCRIBER_LIST
  const crypto = await createListCrypto(setup, list)
  for (const { email, ago } of data.subscribers) {
    await sql`
      INSERT INTO subscribers (list_id, email, key, subscribed_at)
      VALUES (${list}, ${email}, ${await crypto.subscriberKey(email)}, ${at(ago)})
      ON CONFLICT DO NOTHING
    `
  }
  const marks = new Map<string, string>()
  for (const { email } of [...data.subscribers, ...data.unsubscribed]) {
    marks.set(email, await crypto.unsubscribeMark(email))
  }
  for (const { email, ago } of data.unsubscribed) {
    await sql`
      INSERT INTO subscriber_unsubscribes (list_id, mark, unsubscribed_at)
      VALUES (${list}, ${marks.get(email)!}, ${at(ago)})
      ON CONFLICT DO NOTHING
    `
  }
  for (const issue of data.issues) {
    // Everyone on the list that day, those who left later included.
    const audience = [
      ...data.subscribers.filter((s) => s.ago > issue.sentAgo),
      ...data.unsubscribed.filter((s) => s.ago < issue.sentAgo),
    ].map((s) => marks.get(s.email)!)
    const recipients = audience.slice(issue.failed)
    await sql`
      INSERT INTO subscriber_sends (
        list_id, issue, subject, started_at, audience, recipients, sent, failed, completed_at
      ) VALUES (
        ${list}, ${issue.issue}, ${issue.subject}, ${at(issue.sentAgo)}, ${audience},
        ${recipients}, ${recipients.length}, ${issue.failed}, ${at(issue.sentAgo - 4)}
      )
      ON CONFLICT DO NOTHING
    `
  }
}

/**
 * What the development administrator did: their own sign-ins, the people they blocked, a reset
 * mail, ended sessions, a refund, time given, and two exports, each on the trail the admin app
 * writes it to. Their account moves to `data.operator.joinedAgo` when `created` says the seed just
 * made it.
 */
export async function writeOperator(
  sql: postgres.Sql,
  operatorId: number,
  created: boolean,
  data: FakeDemoData,
  userIds: readonly number[],
  subscriptions: readonly (SeededSubscription | null)[],
  at: At,
): Promise<void> {
  const desk = { userAgent: DESK_BROWSER, ip: `198.51.100.24` }
  if (created) {
    await backdateAccounts(sql, [{
      userId: operatorId,
      joined: at(data.operator.joinedAgo),
      device: desk,
    }])
    // The seed made them the administrator a minute after they signed up.
    await sql`
      UPDATE auth_audits SET created_at = ${at(data.operator.joinedAgo - 1)},
        updated_at = ${at(data.operator.joinedAgo - 1)}
      WHERE user_id = ${operatorId} AND event_type = ${AuthAuditEventType.USER_ROLE_CHANGED}
    `
  }
  const who = operatorIdentifier(operatorId)
  const audits = data.operator.signIns.map((ago) =>
    audit(operatorId, AuthAuditEventType.SIGNED_IN, at(ago), null, desk)
  )
  for (const action of data.operator.actions) {
    const when = at(action.ago)
    switch (action.kind) {
      case `blocked`:
      case `password-reset`:
      case `sessions-ended`: {
        const eventType = {
          blocked: AuthAuditEventType.USER_BLOCKED,
          "password-reset": AuthAuditEventType.PASSWORD_RESET_SENT,
          "sessions-ended": AuthAuditEventType.SESSIONS_ENDED,
        }[action.kind]
        audits.push(audit(userIds[action.user], eventType, when, who, desk))
        break
      }
      case `refund`:
      case `time-given`: {
        const seeded = subscriptions[action.subscription]
        if (!seeded) break
        const subscription = data.subscriptions[action.subscription]
        const identifier = action.kind === `refund`
          ? billingAuditIdentifier({
            groupId: seeded.groupId,
            objectId: `pi_fake_${seeded.subscriptionId}`,
            amount: { amount: 900 * subscription.seats, currency: `EUR`, decimals: 2 },
            note: action.note,
          })
          : billingAuditIdentifier({
            groupId: seeded.groupId,
            objectId: seeded.subscriptionId,
            until: at(-(subscription.trialEndIn ?? 0)).toISOString(),
            note: action.note,
          })
        const eventType = action.kind === `refund`
          ? BILLING_AUDIT_EVENTS.paymentRefunded
          : BILLING_AUDIT_EVENTS.timeGiven
        audits.push(audit(operatorId, eventType, when, identifier, desk))
        break
      }
      case `users-exported`:
        audits.push(audit(operatorId, AuthAuditEventType.USERS_EXPORTED, when, who, desk))
        break
      case `subscribers-exported`: {
        const count = data.subscribers.filter((s) => s.ago > action.ago).length
        audits.push(
          audit(
            operatorId,
            AuthAuditEventType.NEWSLETTER_SUBSCRIBERS_EXPORTED,
            when,
            `${DEFAULT_SUBSCRIBER_LIST}:${count}`,
            desk,
          ),
        )
        break
      }
    }
  }
  await insertAudits(sql, audits)
  const latest = Math.min(...data.operator.signIns)
  await sql`
    UPDATE users SET last_seen_at = ${at(latest)}, last_login_at = ${at(latest)}
    WHERE id = ${operatorId}
  `
}

/**
 * The notes people keep in their first group, through the app's own repository, each moved with
 * its audit row to when it was written. Run while that group is the only one they are in.
 */
async function writeOwnNotes(
  sql: postgres.Sql,
  users: readonly FakeUser[],
  ids: readonly number[],
  at: At,
): Promise<void> {
  const firsts = await sql<{ userId: number; groupId: string }[]>`
    SELECT user_id, group_id FROM group_members WHERE user_id IN ${sql(ids)}
  `
  const groupOf = new Map(firsts.map((row) => [row.userId, row.groupId]))
  const notes = new PostgresNoteRepository(sql)
  const dated: { id: string; at: string }[] = []
  for (const [i, user] of users.entries()) {
    for (const note of user.ownNotes) {
      const id = uuidV7()
      const groupId = groupOf.get(ids[i])!
      await notes.create({ id, groupId, title: note.title, body: note.body }, ids[i], null)
      dated.push({ id, at: at(note.ago).toISOString() })
    }
  }
  if (dated.length === 0) return
  const v = sql`jsonb_to_recordset(${sql.json(dated)}::jsonb) AS v(id uuid, at timestamptz)`
  await sql`UPDATE notes n SET created_at = v.at, updated_at = v.at FROM ${v} WHERE n.id = v.id`
  await sql`
    UPDATE audit_events e SET created_at = v.at FROM ${v} WHERE e.entity_id = v.id
  `
}

/**
 * Renumbers the rows of `table` with an id above `after` (and, with `groupIds`, in those groups
 * only) so their ids follow their times. The seed dates rows after writing them, but lists sort by
 * id: without this a feed would jump back and forth in time. The rows keep the same set of ids, so
 * no id is reused or skipped and the table's sequence is untouched.
 */
export async function orderIdsByTime(
  sql: postgres.Sql,
  table: `audit_events` | `auth_audits`,
  after: number,
  groupIds?: readonly string[],
): Promise<void> {
  if (groupIds?.length === 0) return
  const scope = groupIds ? sql`AND group_id IN ${sql(groupIds)}` : sql``
  await sql.begin(async (tx) => {
    // Two steps through negative ids, so no step meets a primary key still in use.
    await tx`
      WITH picked AS (SELECT id, created_at FROM ${tx(table)} WHERE id > ${after} ${scope}),
        slots AS (SELECT id, row_number() OVER (ORDER BY id) AS n FROM picked),
        moves AS (SELECT id, row_number() OVER (ORDER BY created_at, id) AS n FROM picked)
      UPDATE ${tx(table)} t SET id = -slots.id
      FROM moves JOIN slots USING (n)
      WHERE t.id = moves.id
    `
    await tx`UPDATE ${tx(table)} SET id = -id WHERE id < 0`
  })
}

/** The newest id of `table`, or 0: what {@link orderIdsByTime} renumbers after. */
export async function lastId(
  sql: postgres.Sql,
  table: `audit_events` | `auth_audits`,
): Promise<number> {
  const [{ id }] = await sql<{ id: string | null }[]>`SELECT max(id)::text AS id FROM ${sql(table)}`
  return Number(id ?? 0)
}

/** The operator's desk browser. */
const DESK_BROWSER =
  `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36`

/**
 * A finished backup for the development database, which has no backup service, so the admin's
 * System page shows a healthy server there. Never on the public demo: its server's real backup
 * service writes this row. A row already there is kept.
 */
export async function writeDevelopmentBackup(sql: postgres.Sql, at: At): Promise<void> {
  await sql`
    INSERT INTO backup_status (target, succeeded_at)
    VALUES (${BACKUP_TARGET_DATABASE}, ${at(3 * HOUR + 20)})
    ON CONFLICT (target) DO NOTHING
  `
}
