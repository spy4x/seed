/**
 * The open page's palette commands: a view hands them over while it is shown and takes them back
 * when it goes, in a browser DOM (happy-dom).
 */
import { expect } from "@std/expect"
import { afterAll, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render } from "preact"
import { act } from "preact/test-utils"
import type { AdminPageCommand } from "@ui/admin-palette.tsx"
import { pageCommands, usePageCommands } from "./page-commands.ts"
import { newsletterPageCommands } from "./modules/newsletter/module.tsx"
import { adminText } from "./i18n.ts"

const window = new Window({ url: `http://admin.localhost/` })
const own = { document: globalThis.document }

beforeAll(() => {
  Object.assign(globalThis, { document: window.document })
})

afterAll(async () => {
  Object.assign(globalThis, own)
  await window.happyDOM.close()
})

function Page({ commands }: { commands: readonly AdminPageCommand[] }) {
  usePageCommands(commands)
  return null
}

describe(`the open page's palette commands`, () => {
  it(`are shown while their page is, run its latest handler, and leave with it`, async () => {
    const root = document.createElement(`div`)
    const ran: string[] = []
    const block = (handler: string): AdminPageCommand => ({
      id: `user-block`,
      label: `Block`,
      run: () => void ran.push(handler),
    })
    await act(() => render(<Page commands={[block(`first`)]} />, root))
    expect(pageCommands.value.map((command) => command.id)).toEqual([`user-block`])

    await act(() => render(<Page commands={[block(`second`)]} />, root))
    pageCommands.value[0]!.run()
    expect(ran).toEqual([`second`])

    await act(() => render(null, root))
    expect(pageCommands.value).toEqual([])
  })

  it(`offers the newsletter's Export, running the button's export, but not while one runs`, () => {
    let exports = 0
    const commands = newsletterPageCommands(adminText(), false, () => void exports++)
    expect(commands.map((command) => command.id)).toEqual([`newsletter-export`])
    commands[0]!.run()
    expect(exports).toBe(1)
    expect(newsletterPageCommands(adminText(), true, () => {})).toEqual([])
  })
})
