import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { countTestFiles, TEST_FILE_COUNT } from "./repo-facts.ts"

describe("the repository's test count", () => {
  it("counts the .test.ts and .test.tsx files of the apps and libraries", () => {
    expect(countTestFiles([
      `apps/api/routes/notes.test.ts`,
      `libs/ui/notes.test.tsx`,
      `apps/mpa/site.test.ts`,
      `apps/api/routes/notes.ts`,
    ])).toBe(3)
  })

  it("leaves out tests outside the apps and libraries, which the image's build does not hold", () => {
    expect(countTestFiles([
      `tests/spacing.test.ts`,
      `e2e/fixtures/seed.test.ts`,
      `i18n/i18n.test.ts`,
      `infra/scripts/backup.test.ts`,
      `docs/apps/x.test.ts`,
    ])).toBe(0)
  })

  it("leaves out installed packages and build output", () => {
    expect(countTestFiles([
      `apps/mpa/node_modules/pkg/index.test.ts`,
      `apps/mpa/_fresh/server/site.test.ts`,
    ])).toBe(0)
  })

  it("is unknown outside a Vite build, so the page leaves the number out", () => {
    expect(TEST_FILE_COUNT).toBeUndefined()
  })
})
