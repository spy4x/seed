import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { GroupRole } from "@domain/groups"
import { GROUP_PATHS } from "@ui/progressive.tsx"
import { openImported } from "./GroupImportView.tsx"
import { createTranslator } from "@spy4x/platform/universal/i18n"
import appEn from "@i18n/app/en.json" with { type: "json" }

const EN = createTranslator({ language: `en`, catalogs: [{ source: appEn }] })

describe("openImported", () => {
  it("reads the groups first, then puts the new group's page in place of the import page, makes it current and says what came in", async () => {
    const steps: string[] = []
    const notices: unknown[] = []
    const group = {
      id: "7b6d8d6c-1af5-7f04-8ae4-b1ee5d111002",
      name: "Family copy",
      description: "",
      color: null,
      emoji: null,
      role: GroupRole.OWNER,
      authorizationRevision: "1",
      changeSequence: "1",
      updatedAt: new Date("2026-10-21T00:00:00.000Z"),
    }
    await openImported(
      {
        group,
        parts: [
          { kind: "notes", count: 3, one: "note", other: "notes" },
          { kind: "tags", count: 1, one: "tag", other: "tags" },
        ],
      },
      { refreshFromUser: () => Promise.resolve(void steps.push("refresh")) },
      { select: (id) => Promise.resolve(void steps.push(`select ${id}`)) },
      (to, options) => void steps.push(`navigate ${to} ${options.replace}`),
      { success: (notice) => String(notices.push(notice)) },
      EN,
    )
    expect(steps).toEqual([
      "refresh",
      `navigate ${GROUP_PATHS.settings(group.id)} true`,
      `select ${group.id}`,
    ])
    expect(notices).toEqual([{
      title: "Group imported",
      body: `Imported 3 notes and 1 tag into "Family copy".`,
      dataE2E: "group-imported",
    }])
  })
})
