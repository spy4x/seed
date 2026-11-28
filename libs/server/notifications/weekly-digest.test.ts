import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { createListCrypto } from "../subscribers/subscribers.ts"
import { createWeeklyDigestTokens, weeklyDigestUnsubscribeLink } from "./weekly-digest.ts"

/** Throwaway secrets for these tests only. */
const SECRET = `digest-token-test-secret-0123456789abcdef`
const OLD_SECRET = `digest-token-test-old-secret-0123456789ab`

describe(`createWeeklyDigestTokens`, () => {
  it(`verifies its own token back to the user id`, async () => {
    const tokens = await createWeeklyDigestTokens({ secret: SECRET, previousSecrets: [] })
    expect(await tokens.verify(await tokens.sign(42))).toBe(42)
  })

  it(`still verifies a token signed before a secret rotation`, async () => {
    const before = await createWeeklyDigestTokens({ secret: OLD_SECRET, previousSecrets: [] })
    const after = await createWeeklyDigestTokens({ secret: SECRET, previousSecrets: [OLD_SECRET] })
    expect(await after.verify(await before.sign(42))).toBe(42)
  })

  it(`refuses a token signed by a secret it does not know`, async () => {
    const other = await createWeeklyDigestTokens({ secret: OLD_SECRET, previousSecrets: [] })
    const tokens = await createWeeklyDigestTokens({ secret: SECRET, previousSecrets: [] })
    expect(await tokens.verify(await other.sign(42))).toBeNull()
  })

  it(`refuses a forged, truncated, oversize or malformed token`, async () => {
    const tokens = await createWeeklyDigestTokens({ secret: SECRET, previousSecrets: [] })
    const token = await tokens.sign(42)
    const [, signature] = token.split(`.`)
    const forged = [
      `43.${signature}`,
      `${token.slice(0, -1)}${token.endsWith(`A`) ? `B` : `A`}`,
      token.slice(0, -1),
      `${token}A`,
      `${`9`.repeat(60)}.${signature}`,
      `0042.${signature}`,
      `2147483648.${signature}`,
      `-1.${signature}`,
      ` ${token}`,
      ``,
      `x`.repeat(10_000),
    ]
    for (const bad of forged) expect(await tokens.verify(bad)).toBeNull()
  })

  it(`refuses a newsletter token, which is signed under a label of its own`, async () => {
    const tokens = await createWeeklyDigestTokens({ secret: SECRET, previousSecrets: [] })
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
