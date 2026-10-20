/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { DEV_ADMIN_EMAIL } from "@server/auth/demo-accounts.ts"
import { readSeedOptions, SeedConfigError } from "./seed-data.ts"

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

Deno.test("readSeedOptions refuses to seed unless ENV is dev or the public demo is on", () => {
  for (const ENV of ["prod", "test", "", undefined]) {
    for (const DEMO_MODE of [undefined, "", "1", "TRUE", "yes"]) {
      expect(() => readSeedOptions({ ...DEV, ENV, DEMO_MODE })).toThrow(
        new SeedConfigError(
          "ENV must be dev, or DEMO_MODE true: the demo accounts are for development and the public demo only",
        ),
      )
    }
  }
  expect(readSeedOptions({ ...DEV, ENV: "prod", DEMO_MODE: "true" }).password).toBe("12345678")
})

Deno.test("the development administrator's address is on a domain reserved for examples", () => {
  expect(DEV_ADMIN_EMAIL).toMatch(/@example\.(com|net|org)$/)
})
