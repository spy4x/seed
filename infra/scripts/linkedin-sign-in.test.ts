import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { callbackCode, envLines } from "./linkedin-sign-in.ts"

const callback = (query: string) => new URL(`http://localhost:8789/callback?${query}`)

describe(`linkedin:sign-in`, () => {
  it(`takes the code only from a callback with this sign-in's state`, () => {
    expect(callbackCode(callback(`code=abc&state=s1`), `s1`)).toEqual({ code: `abc` })
    expect(callbackCode(callback(`code=abc&state=other`), `s1`)).toHaveProperty(`problem`)
    expect(callbackCode(callback(`code=abc`), `s1`)).toHaveProperty(`problem`)
    expect(callbackCode(callback(`state=s1`), `s1`)).toHaveProperty(`problem`)
  })

  it(`says LinkedIn's own reason when the owner declined`, () => {
    const declined = callback(`error=user_cancelled_login&error_description=The+member+declined`)
    expect(callbackCode(declined, `s1`)).toEqual({ problem: `LinkedIn refused: The member declined` })
  })

  it(`prints the token, its expiry as ISO and the member id as env lines`, () => {
    const lines = envLines({ accessToken: `tok`, expiresAt: `2027-01-05T10:00:00.000Z` }, `m-1`)
    expect(lines).toEqual([
      `LINKEDIN_ACCESS_TOKEN=tok`,
      `LINKEDIN_TOKEN_EXPIRES_AT=2027-01-05T10:00:00.000Z`,
      `LINKEDIN_MEMBER_ID=m-1`,
    ])
  })
})
