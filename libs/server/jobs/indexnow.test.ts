import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { readIndexNowSetup } from "./indexnow.ts"

const SITE = `https://www.example.com`

describe(`readIndexNowSetup`, () => {
  const env = (values: Record<string, string>) => ({ get: (name: string) => values[name] })

  it(`is on with a key and the website's host, over https outside development`, () => {
    expect(
      readIndexNowSetup(env({ INDEXNOW_KEY: `0123abcd`, MPA_DOMAIN: `www.example.com` }), `prod`),
    )
      .toEqual({ key: `0123abcd`, siteUrl: SITE })
  })

  it(`is off without the key or without the website's host`, () => {
    expect(readIndexNowSetup(env({ MPA_DOMAIN: `www.example.com` }), `prod`)).toBeNull()
    expect(readIndexNowSetup(env({ INDEXNOW_KEY: `0123abcd` }), `prod`)).toBeNull()
  })
})
