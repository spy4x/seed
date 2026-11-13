/** `runChoice`: what the shell does with each palette pick. */
import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { SearchChoice } from "@ui/search-palette.tsx"
import { type ChoicePorts, runChoice } from "./palette-choice.ts"

const HOME = `0190a000-0000-7000-8000-000000000001`
const STUDIO = `0190a000-0000-7000-8000-000000000002`

/** Runs `choice` against ports that record each call by name. */
async function run(choice: SearchChoice): Promise<string[]> {
  const calls: string[] = []
  const record = (name: string) => (...args: unknown[]) =>
    void calls.push([name, ...args].join(` `))
  const ports: ChoicePorts = {
    navigate: record(`navigate`),
    currentGroupId: HOME,
    selectGroup: record(`selectGroup`),
    switchGroup: record(`switchGroup`),
    newNote: record(`newNote`),
    runPageCommand: record(`runPageCommand`),
    setTheme: record(`setTheme`),
    openShortcuts: record(`openShortcuts`),
    signOut: record(`signOut`),
    install: record(`install`),
  }
  await runChoice(choice, ports)
  return calls
}

describe(`runChoice`, () => {
  it(`switches groups through the group switcher's switch`, async () => {
    expect(await run({ kind: `switch-group`, groupId: STUDIO })).toEqual([
      `switchGroup ${STUDIO}`,
    ])
  })

  it(`opens the group's settings page for a group picked with Ctrl Enter`, async () => {
    expect(await run({ kind: `group-settings`, groupId: STUDIO })).toEqual([
      `navigate /groups/${STUDIO}`,
    ])
  })

  it(`signs out through the shell's sign-out port, never on its own`, async () => {
    expect(await run({ kind: `sign-out` })).toEqual([`signOut`])
  })

  it(`selects another group's note's group before opening the note, and not its own`, async () => {
    expect(await run({ kind: `note`, noteId: `n1`, groupId: STUDIO })).toEqual([
      `selectGroup ${STUDIO}`,
      `navigate /notes/n1`,
    ])
    expect(await run({ kind: `note`, noteId: `n1`, groupId: HOME })).toEqual([`navigate /notes/n1`])
  })
})
