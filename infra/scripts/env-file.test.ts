/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { MissingEnvError } from "@spy4x/server/config"
import { describeEnvFileError, parseEnvValues } from "./env-file.ts"

Deno.test("parseEnvValues drops an inline comment after a space", () => {
  expect(parseEnvValues(`ENV=dev # or "prod"\nCONTAINER_PROVIDER=docker   # or podman`)).toEqual({
    ENV: "dev",
    CONTAINER_PROVIDER: "docker",
  })
})

Deno.test("parseEnvValues keeps a # that has no space before it, as Compose does", () => {
  expect(parseEnvValues(`DB_PASS=abc#def\nA= # note\nB=x\t# tab`)).toEqual({
    DB_PASS: "abc#def",
    A: "# note",
    B: "x\t# tab",
  })
})

Deno.test("parseEnvValues keeps every = after the first", () => {
  expect(parseEnvValues(`TOKEN=YWJj==`)).toEqual({ TOKEN: "YWJj==" })
})

Deno.test("parseEnvValues skips comment lines and blank lines", () => {
  expect(parseEnvValues(`# SSH_TO_SERVER=old\n\nPROJECT=app\n`)).toEqual({ PROJECT: "app" })
})

Deno.test("parseEnvValues strips matching quotes and keeps a quoted #", () => {
  expect(parseEnvValues(`A="x # y"\nB='z'`)).toEqual({ A: "x # y", B: "z" })
})

Deno.test("parseEnvValues drops a comment after a closing quote, as Compose does", () => {
  expect(parseEnvValues(`A="x # y" # note\nB='it"s' # note`)).toEqual({ A: "x # y", B: `it"s` })
})

Deno.test("parseEnvValues names the file and line of a quoted value followed by text", () => {
  expect(() => parseEnvValues(`A=1\nB="x" y`, "infra/envs/.env")).toThrow(
    /^infra\/envs\/\.env: unsupported env syntax at line 2: unterminated quote\. Supported:/,
  )
})

Deno.test("parseEnvValues reads the shipped .env.example with ENV=dev", async () => {
  const values = parseEnvValues(
    await Deno.readTextFile(new URL("../envs/.env.example", import.meta.url)),
  )
  expect(values.ENV).toBe("dev")
  expect(values.CONTAINER_PROVIDER).toBe("docker")
})

Deno.test("describeEnvFileError names the env file to fix for a missing variable", () => {
  expect(describeEnvFileError(new MissingEnvError("SSH_TO_SERVER"), "infra/envs/.env.staging"))
    .toBe("missing required environment variable: SSH_TO_SERVER in infra/envs/.env.staging")
})

Deno.test("describeEnvFileError passes any other error through as it is", () => {
  expect(describeEnvFileError(new Error("line 3 is bad"), "f")).toBe("line 3 is bad")
})
