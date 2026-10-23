import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { readServerFilesSetup } from "./settings.ts"

const ALL = {
  S3_ENDPOINT: `http://app-garage:3900`,
  S3_REGION: `garage`,
  S3_BUCKET: `app-files`,
  S3_ACCESS_KEY_ID: `GK0123`,
  S3_SECRET_ACCESS_KEY: `secret`,
}
const reader = (values: Record<string, string>) => ({ get: (name: string) => values[name] })

describe("readServerFilesSetup", () => {
  it("reads the five settings the worker needs", () => {
    expect(readServerFilesSetup(reader(ALL))).toEqual({
      success: true,
      output: {
        endpoint: ALL.S3_ENDPOINT,
        region: ALL.S3_REGION,
        bucket: ALL.S3_BUCKET,
        accessKeyId: ALL.S3_ACCESS_KEY_ID,
        secretAccessKey: ALL.S3_SECRET_ACCESS_KEY,
      },
    })
  })

  it("names every missing or blank setting and gives no settings", () => {
    const result = readServerFilesSetup(
      reader({ ...ALL, S3_BUCKET: ` `, S3_SECRET_ACCESS_KEY: `` }),
    )
    expect(result.success).toBe(false)
    expect(result.error).toContain(`S3_BUCKET, S3_SECRET_ACCESS_KEY`)
    expect(result.output).toBeUndefined()
  })
})
