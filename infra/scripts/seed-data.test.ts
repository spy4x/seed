/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { DEMO_EMAIL, readSeedOptions, SeedConfigError } from "./seed-data.ts"

const PEPPER = "p".repeat(32)
const DEV = { ENV: "dev", AUTH_PEPPER: PEPPER, SEED_PASSWORD: "12345678" }

Deno.test("readSeedOptions accepts the API's pepper and a sign-up-sized password", () => {
  expect(readSeedOptions(DEV)).toEqual({
    pepper: PEPPER,
    password: "12345678",
  })
})

Deno.test("readSeedOptions refuses a missing or short AUTH_PEPPER", () => {
  expect(() => readSeedOptions({ ...DEV, AUTH_PEPPER: undefined })).toThrow(/AUTH_PEPPER/)
  expect(() => readSeedOptions({ ...DEV, AUTH_PEPPER: "p".repeat(31) })).toThrow(/AUTH_PEPPER/)
})

Deno.test("readSeedOptions refuses a password sign-up would refuse", () => {
  for (const password of [undefined, "1234567", "x".repeat(51)]) {
    expect(() => readSeedOptions({ ...DEV, SEED_PASSWORD: password })).toThrow(/SEED_PASSWORD/)
  }
})

Deno.test("readSeedOptions refuses to seed unless ENV is dev, as db:reset does", () => {
  for (const ENV of ["prod", "test", "", undefined]) {
    expect(() => readSeedOptions({ ...DEV, ENV })).toThrow(
      new SeedConfigError("ENV must be dev: the demo user is for development databases only"),
    )
  }
})

Deno.test("the demo user's address is on a domain reserved for examples", () => {
  expect(DEMO_EMAIL).toMatch(/@example\.(com|net|org)$/)
})
