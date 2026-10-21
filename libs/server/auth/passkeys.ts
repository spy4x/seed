/**
 * Passkeys (#222) in Postgres: the `auth_passkeys` row beside a passkey's `auth_keys` row (method
 * {@link PASSKEY_METHOD}, the credential id as `subject`). Every function takes the person's id
 * from the caller, which takes it from the session or from the key a sign-in found; nothing here
 * reads a request.
 *
 * Reads no environment and imports no singleton.
 *
 * @module
 */

import type postgres from "postgres"

/** The `auth_keys.method` of a passkey. */
export const PASSKEY_METHOD = "passkey"

/** The audit identifier of a passkey: its method and the name the person gave it. */
export function passkeyIdentifier(name: string): string {
  return `${PASSKEY_METHOD} name=${name}`
}

/** One passkey of a person, as the methods card and the admin panel list it. */
export interface PasskeySummary {
  keyId: number
  name: string
  createdAt: Date
  lastUsedAt: Date | null
}

/** A passkey as a sign-in checks it: the key's owner and what its signature is checked with. */
export interface StoredPasskey {
  keyId: number
  userId: number
  credentialId: string
  publicKey: Uint8Array
  counter: number
  transports: string[]
  name: string
}

/** What {@link insertPasskey} stores beside a key the caller just added. */
export interface NewPasskey {
  keyId: number
  userId: number
  publicKey: Uint8Array
  counter: number
  transports: readonly string[]
  backedUp: boolean
  name: string
}

/** Stores the passkey part of key `keyId`, which must be a {@link PASSKEY_METHOD} key of `userId`. */
export async function insertPasskey(sql: postgres.Sql, passkey: NewPasskey): Promise<void> {
  await sql`
    INSERT INTO auth_passkeys (key_id, user_id, public_key, counter, transports, backed_up, name)
    VALUES (
      ${passkey.keyId}, ${passkey.userId}, ${passkey.publicKey}, ${passkey.counter},
      ${sql.array([...passkey.transports])}, ${passkey.backedUp}, ${passkey.name}
    )
  `
}

/** The person's passkeys, oldest first. */
export async function listPasskeys(sql: postgres.Sql, userId: number): Promise<PasskeySummary[]> {
  return await sql<(PasskeySummary & postgres.Row)[]>`
    SELECT p.key_id, p.name, k.created_at, p.last_used_at
    FROM auth_passkeys p JOIN auth_keys k ON k.id = p.key_id AND k.user_id = p.user_id
    WHERE p.user_id = ${userId}
    ORDER BY k.created_at, p.key_id
  `
}

/** The person's passkeys as the browser is told to exclude or allow them: id and transports. */
export async function passkeyDescriptors(
  sql: postgres.Sql,
  userId: number,
): Promise<{ id: string; transports: string[] }[]> {
  return await sql<({ id: string; transports: string[] } & postgres.Row)[]>`
    SELECT k.subject AS id, p.transports
    FROM auth_passkeys p JOIN auth_keys k ON k.id = p.key_id AND k.user_id = p.user_id
    WHERE p.user_id = ${userId}
    ORDER BY p.key_id
  `
}

/** The passkey whose credential id is `credentialId`, or `null` when no account has it. */
export async function findPasskey(
  sql: postgres.Sql,
  credentialId: string,
): Promise<StoredPasskey | null> {
  const [row] = await sql<(StoredPasskey & { counter: string } & postgres.Row)[]>`
    SELECT p.key_id, p.user_id, k.subject AS credential_id, p.public_key, p.counter,
      p.transports, p.name
    FROM auth_keys k JOIN auth_passkeys p ON p.key_id = k.id AND p.user_id = k.user_id
    WHERE k.method = ${PASSKEY_METHOD} AND k.subject = ${credentialId}
  `
  if (!row) return null
  // INT8 comes back as a string; a counter is at most 2^32 - 1, which a number holds exactly.
  return { ...row, counter: Number(row.counter), publicKey: new Uint8Array(row.publicKey) }
}

/**
 * Records a sign-in with passkey `keyId`: the counter the verified response carried, whether it is
 * backed up now, and the time. The counter never goes down here, so two sign-ins that race keep
 * the higher one.
 */
export async function recordPasskeyUse(
  sql: postgres.Sql,
  keyId: number,
  use: { counter: number; backedUp: boolean },
): Promise<void> {
  await sql`
    UPDATE auth_passkeys
    SET counter = GREATEST(counter, ${use.counter}), backed_up = ${use.backedUp},
      last_used_at = CURRENT_TIMESTAMP
    WHERE key_id = ${keyId}
  `
}

/**
 * Renames passkey `keyId` of `userId` and gives back the name it had, for the audit row. `null`
 * when the person has no such passkey.
 */
export async function renamePasskey(
  sql: postgres.Sql,
  userId: number,
  keyId: number,
  name: string,
): Promise<string | null> {
  const [row] = await sql<{ previous: string }[]>`
    UPDATE auth_passkeys AS passkey SET name = ${name}
    FROM (
      SELECT key_id, name FROM auth_passkeys
      WHERE key_id = ${keyId} AND user_id = ${userId}
      FOR UPDATE
    ) AS old
    WHERE passkey.key_id = old.key_id
    RETURNING old.name AS previous
  `
  return row?.previous ?? null
}

/**
 * `base`, or `base 2`, `base 3` and so on: the first that none of `taken` uses, cut so it stays
 * within `maxLength` characters.
 */
export function uniqueName(base: string, taken: readonly string[], maxLength: number): string {
  const used = new Set(taken)
  for (let n = 1;; n++) {
    const suffix = n === 1 ? "" : ` ${n}`
    const name = `${base.slice(0, maxLength - suffix.length).trimEnd()}${suffix}`
    if (!used.has(name)) return name
  }
}
