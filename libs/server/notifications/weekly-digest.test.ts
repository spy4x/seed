import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { WEEKLY_DIGEST_TOKEN_MAX_LENGTH } from "@domain/notifications"
import { createListCrypto } from "../subscribers/subscribers.ts"
import { createWeeklyDigestTokens, weeklyDigestUnsubscribeLink } from "./weekly-digest.ts"

/** Throwaway secrets for these tests only. */
const SECRET = `digest-token-test-secret-0123456789abcdef`
const OLD_SECRET = `digest-token-test-old-secret-0123456789ab`

describe(`createWeeklyDigestTokens`, () => {
  it(`verifies its own token back to the user id`, async () => {
    const tokens = createWeeklyDigestTokens({ secret: SECRET, previousSecrets: [] })
    expect(await tokens.verify(await tokens.sign(42))).toBe(42)
  })

  it(`does not show the user id in plain text at the front of the token`, async () => {
    const token = await createWeeklyDigestTokens({ secret: SECRET, previousSecrets: [] }).sign(42)
    expect(token.startsWith(`42.`)).toBe(false)
  })

  it(`fits a token of the largest user id under the length cap`, async () => {
    const tokens = createWeeklyDigestTokens({ secret: SECRET, previousSecrets: [] })
    const token = await tokens.sign(2_147_483_647)
    expect(token.length).toBeLessThanOrEqual(WEEKLY_DIGEST_TOKEN_MAX_LENGTH)
    expect(await tokens.verify(token)).toBe(2_147_483_647)
  })

  it(`still verifies a token signed before a secret rotation`, async () => {
    const before = createWeeklyDigestTokens({ secret: OLD_SECRET, previousSecrets: [] })
    const after = createWeeklyDigestTokens({ secret: SECRET, previousSecrets: [OLD_SECRET] })
    expect(await after.verify(await before.sign(42))).toBe(42)
  })

  it(`refuses a token signed by a secret it does not know`, async () => {
    const other = createWeeklyDigestTokens({ secret: OLD_SECRET, previousSecrets: [] })
    const tokens = createWeeklyDigestTokens({ secret: SECRET, previousSecrets: [] })
    expect(await tokens.verify(await other.sign(42))).toBeNull()
  })

  it(`refuses a forged, truncated, oversize or malformed token`, async () => {
    const tokens = createWeeklyDigestTokens({ secret: SECRET, previousSecrets: [] })
    const token = await tokens.sign(42)
    const [payload, signature] = token.split(`.`)
    const otherPayload = (await tokens.sign(43)).split(`.`)[0]
    const forged = [
      `${otherPayload}.${signature}`,
      `42.${signature}`,
      `${payload}.${signature.slice(0, -1)}${signature.endsWith(`A`) ? `B` : `A`}`,
      token.slice(0, -1),
      `${token}A`,
      `${token}${`A`.repeat(WEEKLY_DIGEST_TOKEN_MAX_LENGTH)}`,
      ` ${token}`,
      ``,
      `x`.repeat(10_000),
    ]
    for (const bad of forged) expect(await tokens.verify(bad)).toBeNull()
  })

  it(`refuses a newsletter unsubscribe token signed from the same secret`, async () => {
    const tokens = createWeeklyDigestTokens({ secret: SECRET, previousSecrets: [] })
    const list = await createListCrypto({ secret: SECRET, previousSecrets: [] }, `news`)
    const newsletter = await list.unsubscribeToken(
      `ann@example.com`,
      await list.subscriberKey(`ann@example.com`),
    )
    expect(await tokens.verify(newsletter)).toBeNull()
  })
})

describe(`weeklyDigestUnsubscribeLink`, () => {
  it(`points at the API at the app's address, with the token in the query`, () => {
    expect(weeklyDigestUnsubscribeLink(`https://app.example.com`, `7.ab-_`)).toBe(
      `https://app.example.com/api/weekly-digest/unsubscribe?token=7.ab-_`,
    )
  })
})
