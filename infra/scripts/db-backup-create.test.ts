/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { planBackup } from "./db-backup-create.ts"
import { MissingEnvError } from "@spy4x/server/config"

const VALUES = {
  PROJECT: "app",
  DB_NAME: "appdb",
  DB_USER: "appuser",
  DB_PASS: "db-secret",
  S3_BUCKET_BACKUPS_NAME: "app-backups",
  S3_BUCKET_BACKUPS_DB_FOLDER: "db",
  S3_BUCKET_BACKUPS_REGION: "eu-central-1",
  S3_BUCKET_BACKUPS_ENDPOINT: "https://s3.example.com",
  S3_BUCKET_BACKUPS_ACCESS_KEY_ID: "key-id",
  S3_BUCKET_BACKUPS_SECRET_ACCESS_KEY: "s3-secret",
}
const NOW = new Date("2026-09-30T01:02:03.456Z")

Deno.test("planBackup dumps the project's database container as the configured user", () => {
  const plan = planBackup(VALUES, NOW)
  expect(plan.fileName).toBe("appdb-2026-09-30T01_02_03_456Z.sql.gz")
  expect(plan.dump.args).toEqual([
    "exec",
    "-i",
    "-e",
    "PGPASSWORD",
    "app-db",
    "pg_dump",
    "-h",
    "app-db",
    "-U",
    "appuser",
    "appdb",
  ])
  expect(plan.dump.env).toEqual({ PGPASSWORD: "db-secret" })
})

Deno.test("planBackup uploads the file to the bucket folder under the same name", () => {
  const upload = planBackup(VALUES, NOW).upload("/tmp/db-backup-x")
  expect(upload.args).toContain("/tmp/db-backup-x/appdb-2026-09-30T01_02_03_456Z.sql.gz")
  expect(upload.args).toContain("s3://app-backups/db/appdb-2026-09-30T01_02_03_456Z.sql.gz")
  expect(upload.env).toEqual({
    AWS_ACCESS_KEY_ID: "key-id",
    AWS_SECRET_ACCESS_KEY: "s3-secret",
    AWS_DEFAULT_REGION: "eu-central-1",
    AWS_ENDPOINT_URL: "https://s3.example.com",
  })
})

Deno.test("planBackup keeps passwords and keys out of docker's arguments", () => {
  const plan = planBackup(VALUES, NOW)
  const args = [...plan.dump.args, ...plan.upload("/tmp/x").args].join(" ")
  for (const secret of ["db-secret", "key-id", "s3-secret"]) {
    expect(args).not.toContain(secret)
  }
})

Deno.test("planBackup refuses an env file without DB_PASS", () => {
  const { DB_PASS: _, ...values } = VALUES
  expect(() => planBackup(values, NOW))
    .toThrow(new MissingEnvError("DB_PASS"))
})
