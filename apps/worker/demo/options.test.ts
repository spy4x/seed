/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { readDemoAdmin, SeedConfigError } from "./options.ts"

const PEPPER = "p".repeat(32)
const DEMO = { DEMO_MODE: "true", AUTH_PEPPER: PEPPER, DEMO_ADMIN_PASSWORD: "12345678" }

Deno.test("readDemoAdmin reads the password and the API's pepper on the demo", () => {
  expect(readDemoAdmin(DEMO)).toEqual({ pepper: PEPPER, password: "12345678" })
})

Deno.test("readDemoAdmin seeds nobody when the password is unset or the demo is off", () => {
  expect(readDemoAdmin({ ...DEMO, DEMO_ADMIN_PASSWORD: undefined })).toBeNull()
  expect(readDemoAdmin({ ...DEMO, DEMO_ADMIN_PASSWORD: "" })).toBeNull()
  for (const DEMO_MODE of [undefined, "", "false", "1"]) {
    expect(readDemoAdmin({ ...DEMO, DEMO_MODE }), String(DEMO_MODE)).toBeNull()
  }
})

Deno.test("readDemoAdmin refuses a password sign-up would refuse, without its value", () => {
  for (const password of ["1234567", "x".repeat(51)]) {
    const read = () => readDemoAdmin({ ...DEMO, DEMO_ADMIN_PASSWORD: password })
    expect(read).toThrow(SeedConfigError)
    expect(read).toThrow(/DEMO_ADMIN_PASSWORD must be 8 to 50 characters/)
    try {
      read()
    } catch (error) {
      expect((error as Error).message).not.toContain(password)
    }
  }
})

Deno.test("readDemoAdmin refuses a missing or short AUTH_PEPPER", () => {
  expect(() => readDemoAdmin({ ...DEMO, AUTH_PEPPER: undefined })).toThrow(/AUTH_PEPPER/)
  expect(() => readDemoAdmin({ ...DEMO, AUTH_PEPPER: "p".repeat(31) })).toThrow(/AUTH_PEPPER/)
})
