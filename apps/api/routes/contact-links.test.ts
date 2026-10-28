import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { PublicContactLink } from "@domain/contact-links"
import { createPublicContactLinksRoute } from "./contact-links.ts"

const LINKS: PublicContactLink[] = [
  { kind: `telegram`, value: `my_shop`, label: null },
  { kind: `phone`, value: `+84912345678`, label: `Call us` },
]

describe(`public contact links route`, () => {
  it(`answers every link in order, as the reads give them`, async () => {
    const app = createPublicContactLinksRoute(() => Promise.resolve(LINKS))
    const response = await app.request(`http://api.test/`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ links: LINKS })
  })
})
