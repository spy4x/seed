/**
 * The page an unknown address shows (#368), driven in a browser DOM (happy-dom): its heading, its
 * sentence and where its one link goes, for a signed-in person, a signed-out visitor and an operator.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render } from "preact"
import { act } from "preact/test-utils"
import { type NotFoundAudience, NotFoundScreen } from "./not-found-screen.tsx"

const window = new Window({ url: "http://app.localhost/no-such-page" })
const own = { document: globalThis.document, location: globalThis.location }

beforeAll(() => {
  // A link is routed only when it points at the page's own origin (`location`).
  Object.assign(globalThis, { document: window.document, location: window.location })
})

afterAll(async () => {
  Object.assign(globalThis, own)
  await window.happyDOM.close()
})

let root: HTMLElement | null = null

afterEach(async () => {
  if (root) await act(() => render(null, root!))
  document.body.innerHTML = ""
  root = null
})

/** Draws the page for `audience` and returns every `navigate` call it makes. */
async function mount(audience: NotFoundAudience): Promise<string[]> {
  const heard: string[] = []
  root = document.createElement("div")
  document.body.append(root)
  await act(() =>
    render(<NotFoundScreen audience={audience} navigate={(href) => heard.push(href)} />, root!)
  )
  return heard
}

function find(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector)
  if (!element) throw new Error(`nothing matches ${selector}`)
  return element
}

async function clickLink(): Promise<void> {
  await act(() => {
    find(`[data-e2e=not-found-link]`).dispatchEvent(
      new window.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event,
    )
  })
}

describe("NotFoundScreen", () => {
  it("tells a signed-in person the page is not found and routes the link to the notes", async () => {
    const heard = await mount(`member`)
    expect(find(`[data-e2e=not-found] h1`).textContent).toBe(`Page not found`)
    expect(find(`[data-e2e=not-found]`).textContent).toContain(`the page has moved`)
    expect(find(`[data-e2e=not-found-link]`).getAttribute(`href`)).toBe(`/notes`)
    await clickLink()
    expect(heard).toEqual([`/notes`])
  })

  it("offers a signed-out visitor a link to sign in", async () => {
    const heard = await mount(`visitor`)
    expect(find(`[data-e2e=not-found] h1`).textContent).toBe(`Page not found`)
    expect(find(`[data-e2e=not-found]`).textContent).toContain(`Sign in to get to your notes`)
    expect(find(`[data-e2e=not-found-link]`).getAttribute(`href`)).toBe(`/sign-in`)
    await clickLink()
    expect(heard).toEqual([`/sign-in`])
  })

  it("sends an operator back to the admin dashboard", async () => {
    const heard = await mount(`operator`)
    expect(find(`[data-e2e=not-found] h1`).textContent).toBe(`Page not found`)
    expect(find(`[data-e2e=not-found]`).textContent).toContain(`an admin page`)
    expect(find(`[data-e2e=not-found-link]`).getAttribute(`href`)).toBe(`/`)
    await clickLink()
    expect(heard).toEqual([`/`])
  })
})
