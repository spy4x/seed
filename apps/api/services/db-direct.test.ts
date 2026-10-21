import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { directDbEnv } from "./db-direct.ts"

const POOLED = {
  DB_HOST: "example-pgbouncer",
  DB_PORT: "6432",
  DB_USER: "app",
  DB_PASS: "app",
  DB_NAME: "app",
}

describe("the API's direct Postgres connection", () => {
  it("goes to DB_DIRECT_HOST and DB_DIRECT_PORT instead of the pooler", () => {
    const env = directDbEnv({ ...POOLED, DB_DIRECT_HOST: "example-db", DB_DIRECT_PORT: "5433" })
    expect(env).toMatchObject({ DB_HOST: "example-db", DB_PORT: "5433", DB_NAME: "app" })
  })

  it("uses Postgres' own port when DB_DIRECT_PORT is unset", () => {
    const env = directDbEnv({ ...POOLED, DB_DIRECT_HOST: "example-db" })
    expect(env).toMatchObject({ DB_HOST: "example-db", DB_PORT: "5432" })
  })

  it("is DB_HOST and DB_PORT when no pooler stands between", () => {
    expect(directDbEnv(POOLED)).toEqual(POOLED)
  })
})
