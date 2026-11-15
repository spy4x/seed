/** `runChoice`: what the shell does with each palette pick. */
import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { SearchChoice } from "@ui/search-palette.tsx"
import { type ChoicePorts, runChoice } from "./palette-choice.ts"

const HOME = `0190a000-0000-7000-8000-000000000001`
const STUDIO = `0190a000-0000-7000-8000-000000000002`

const MADE = `0190a000-0000-7000-8000-0000000000aa`

/**
 * Runs `choice` against ports that record each call by name. A create resolves {@link MADE}, or
 * `null` with `refused`.
 */
async function run(choice: SearchChoice, refused = false): Promise<string[]> {
  const calls: string[] = []
  const record = (name: string) => (...args: unknown[]) =>
    void calls.push([name, ...args].join(` `))
  const create = (name: string) => (...args: unknown[]) => {
    record(name)(...args)
    return Promise.resolve(refused ? null : MADE)
  }
  const ports: ChoicePorts = {
    navigate: record(`navigate`),
    currentGroupId: HOME,
    selectGroup: record(`selectGroup`),
    switchGroup: record(`switchGroup`),
    newNote: record(`newNote`),
    addNote: create(`addNote`),
    fillForm: record(`fillForm`),
    createFromForm: create(`createFromForm`),
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

  describe(`a quick-create pick`, () => {
    const quick = (entity: `note` | `tag` | `group`, now?: boolean): SearchChoice => ({
      kind: `quick-create`,
      entity,
      title: `groceries`,
      ...(now ? { now } : {}),
    })

    it(`opens the New note dialog with the text as its title on Enter`, async () => {
      expect(await run(quick(`note`))).toEqual([`newNote groceries`])
    })

    it(`adds the note and opens its page on Ctrl Enter`, async () => {
      expect(await run(quick(`note`, true))).toEqual([
        `addNote groceries`,
        `navigate /notes/${MADE}`,
      ])
    })

    it(`stays on the page when the note is refused: the dialog holds the text and why`, async () => {
      expect(await run(quick(`note`, true), true)).toEqual([`addNote groceries`])
    })

    it(`opens the new tag page with the name filled in on Enter`, async () => {
      expect(await run(quick(`tag`))).toEqual([`fillForm tag groceries`, `navigate /tags/new`])
    })

    it(`creates the tag and opens its editor on Ctrl Enter`, async () => {
      expect(await run(quick(`tag`, true))).toEqual([
        `fillForm tag groceries`,
        `createFromForm tag`,
        `navigate /tags/${MADE}`,
      ])
    })

    it(`opens the new tag page, which keeps the text and why, when the tag is refused`, async () => {
      expect(await run(quick(`tag`, true), true)).toEqual([
        `fillForm tag groceries`,
        `createFromForm tag`,
        `navigate /tags/new`,
      ])
    })

    it(`opens the new group page with the name filled in on Enter`, async () => {
      expect(await run(quick(`group`))).toEqual([
        `fillForm group groceries`,
        `navigate /groups/new`,
      ])
    })

    it(`creates the group, opens its page and makes it the current group on Ctrl Enter`, async () => {
      expect(await run(quick(`group`, true))).toEqual([
        `fillForm group groceries`,
        `createFromForm group`,
        `navigate /groups/${MADE}`,
        `selectGroup ${MADE}`,
      ])
    })

    it(`opens the new group page, which keeps the text and why, when the group is refused`, async () => {
      expect(await run(quick(`group`, true), true)).toEqual([
        `fillForm group groceries`,
        `createFromForm group`,
        `navigate /groups/new`,
      ])
    })
  })
})
