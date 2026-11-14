/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { readEnvRecord } from "@spy4x/platform/server/process"
import { DEMO_ADMIN_ENV_NAMES, readDemoAdmins, SeedConfigError } from "./options.ts"

const PEPPER = "p".repeat(32)
const DEMO = { DEMO_MODE: "true", AUTH_PEPPER: PEPPER, DEMO_ADMIN_PASSWORD: "12345678" }

Deno.test("readDemoAdmins reads the private password and the API's pepper on the demo", () => {
  expect(readDemoAdmins(DEMO)).toEqual({ pepper: PEPPER, privatePassword: "12345678" })
})

Deno.test("readDemoAdmins keeps the public administrator when the private password is unset", () => {
  const unset = { pepper: PEPPER, privatePassword: null }
  expect(readDemoAdmins({ ...DEMO, DEMO_ADMIN_PASSWORD: undefined })).toEqual(unset)
  expect(readDemoAdmins({ ...DEMO, DEMO_ADMIN_PASSWORD: "" })).toEqual(unset)
})

Deno.test("readDemoAdmins seeds nobody when the demo is off", () => {
  for (const DEMO_MODE of [undefined, "", "false", "1"]) {
    expect(readDemoAdmins({ ...DEMO, DEMO_MODE }), String(DEMO_MODE)).toBeNull()
  }
})

Deno.test("readDemoAdmins refuses a password sign-up would refuse, without its value", () => {
  for (const password of ["1234567", "x".repeat(51)]) {
    const read = () => readDemoAdmins({ ...DEMO, DEMO_ADMIN_PASSWORD: password })
    expect(read).toThrow(SeedConfigError)
    expect(read).toThrow(/DEMO_ADMIN_PASSWORD must be 8 to 50 characters/)
    try {
      read()
    } catch (error) {
      expect((error as Error).message).not.toContain(password)
    }
  }
})

Deno.test("readDemoAdmins refuses a missing or short AUTH_PEPPER, private password or not", () => {
  for (const DEMO_ADMIN_PASSWORD of ["12345678", undefined]) {
    const env = { ...DEMO, DEMO_ADMIN_PASSWORD }
    expect(() => readDemoAdmins({ ...env, AUTH_PEPPER: undefined })).toThrow(/AUTH_PEPPER/)
    expect(() => readDemoAdmins({ ...env, AUTH_PEPPER: "p".repeat(31) })).toThrow(/AUTH_PEPPER/)
  }
})

Deno.test("the worker's demo variable list reaches readDemoAdmins, AUTH_PEPPER included", () => {
  const env = { get: (name: string) => (DEMO as Record<string, string>)[name] }
  expect(readDemoAdmins(readEnvRecord(DEMO_ADMIN_ENV_NAMES, env))).toEqual({
    pepper: PEPPER,
    privatePassword: "12345678",
  })
})
