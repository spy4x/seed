/// <reference lib="deno.ns" />
/**
 * Holds `.gitignore` to one rule: the Web Push private key (`vapid.json`) is never tracked, in
 * whatever folder it is written. The API writes it to its working directory by default
 * (`apps/api/services/config.ts`), so a rule that names one folder lets `git add -A` commit it.
 */

import { expect } from "@std/expect"

Deno.test("ignores vapid.json in every folder, not only in infra/configs", async () => {
  const rules = (await Deno.readTextFile(new URL("../.gitignore", import.meta.url))).split("\n")
  // A pattern with no slash matches at any depth.
  expect(rules).toContain(`vapid.json`)
})
