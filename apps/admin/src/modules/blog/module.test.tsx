/**
 * The blog editor page inside the admin app's navigation, driven in a browser DOM (happy-dom): a
 * `g` shortcut, which navigates from code, asks before it drops unsaved edits to a post.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render } from "preact"
import { act } from "preact/test-utils"
import { Route, Router, Switch } from "wouter-preact"
import { memoryLocation } from "wouter-preact/memory-location"
import { IconUsers } from "@spy4x/preact-icons"
import { createToastStore } from "@spy4x/preact-signals/toast"
import { createLeaveGuard } from "@spy4x/preact-ui/unsaved-guard"
import type { BlogPost } from "@domain/blog"
import type { User } from "@domain/identity"
import type { Formatters } from "@spy4x/time/format"
import type { AdminApiResult, AdminFetch } from "../../state.ts"
import { guardNavigate } from "../../leave.ts"
import { adminShortcutRows } from "../../shortcuts.ts"
import type { AdminContext, AdminModule } from "../types.ts"
import { blogModule } from "./module.tsx"

const window = new Window({ url: "http://admin.localhost/blog" })
const own = {
  document: globalThis.document,
  location: globalThis.location,
  Element: globalThis.Element,
  HTMLAnchorElement: globalThis.HTMLAnchorElement,
  FormData: globalThis.FormData,
  getComputedStyle: globalThis.getComputedStyle,
}

beforeAll(() => {
  Object.assign(globalThis, {
    document: window.document,
    location: window.location,
    Element: window.Element,
    HTMLAnchorElement: window.HTMLAnchorElement,
    FormData: window.FormData,
    getComputedStyle: window.getComputedStyle.bind(window),
  })
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

const ID = `0195f0b4-3c1e-7a00-8000-0000000000aa`

const post: BlogPost = {
  id: ID,
  slug: `hello`,
  title: `Hello`,
  seoTitle: null,
  description: `A post.`,
  tldr: [],
  topic: null,
  coverUrl: null,
  coverAlt: null,
  bodyMd: `Text.`,
  status: `draft`,
  publishAt: null,
  publishedAt: null,
  contentUpdatedAt: null,
  authorId: 7,
  authorName: `Ann`,
  newsletterList: null,
  newsletterSentAt: null,
  newsletterRecipients: null,
  createdAt: `2026-10-20T10:00:00.000Z`,
  updatedAt: `2026-10-20T10:00:00.000Z`,
  version: 1,
}

const ok = <T,>(data: T) => Promise.resolve({ ok: true, status: 200, data } as AdminApiResult<T>)

const request = ((path: string) => {
  if (path.endsWith(`/topics`)) return ok({ topics: [] })
  if (path.endsWith(`/newsletter`)) return ok({ enabled: false, lists: [], siteUrl: null })
  if (/\/posts(\?|$)/.test(path)) {
    return ok({ posts: [], counts: { all: 0, draft: 0, scheduled: 0, published: 0 } })
  }
  return ok({ post })
}) as AdminFetch

/** A second module, so `g u` has somewhere to go. */
const users: AdminModule = {
  id: `users`,
  nav: { name: `Users`, href: `/users`, Icon: IconUsers },
  routes: [],
}

/**
 * The editor of one post on `/blog/:id`, wired as the app wires it (`app.tsx`): one leave guard,
 * the context's `navigate` and the shortcuts both through `guardNavigate`.
 */
async function openEditor() {
  const memory = memoryLocation({ path: `/blog/${ID}`, record: true })
  const leaveGuard = createLeaveGuard()
  const navigate = guardNavigate(leaveGuard, memory.navigate)
  const context: AdminContext = {
    request,
    toasts: createToastStore(),
    operator: { id: 7 } as User,
    navigate,
    leaveGuard,
    personTabs: [],
    format: () => ({}) as Formatters,
  }
  root = document.createElement("div")
  document.body.append(root)
  await act(() =>
    render(
      <Router hook={memory.hook}>
        <Switch>
          {blogModule.routes.map(({ path, View }) => (
            <Route key={path} path={path}>
              {(params) => <View context={context} params={params as Record<string, string>} />}
            </Route>
          ))}
          <Route path="/users">
            <p data-e2e="users-page">Users</p>
          </Route>
        </Switch>
      </Router>,
      root!,
    )
  )
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  const rows = adminShortcutRows({
    modules: [blogModule, users],
    path: `/blog/${ID}`,
    navigate,
    openShortcuts: () => {},
    focusListFilter: () => {},
  })
  const goToUsers = rows.find((row) => row.keys === `g u`)!
  return { memory, pressGoToUsers: () => act(() => goToUsers.run!()) }
}

function titleField(): HTMLInputElement {
  return document.querySelector(`[data-e2e=admin-blog-title-field]`) as unknown as HTMLInputElement
}

async function typeTitle(value: string): Promise<void> {
  const field = titleField()
  field.value = value
  await act(() => {
    field.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event)
  })
}

function dialogButton(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("dialog button")]
    .find((candidate) => candidate.textContent?.trim() === text)
  if (!found) throw new Error(`no dialog button "${text}"`)
  return found as unknown as HTMLButtonElement
}

async function click(element: Element): Promise<void> {
  await act(() => {
    element.dispatchEvent(
      new window.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event,
    )
  })
}

it(`asks before a g shortcut leaves unsaved edits, keeps them on Keep editing, leaves on Leave`, async () => {
  const { memory, pressGoToUsers } = await openEditor()
  await typeTitle(`Hello, edited`)

  await pressGoToUsers()
  expect(document.querySelector(`dialog`)?.textContent).toContain(`Leave without saving?`)
  expect(memory.history.at(-1)).toBe(`/blog/${ID}`)

  await click(dialogButton(`Keep editing`))
  expect(document.querySelector(`dialog`)).toBeNull()
  expect(memory.history.at(-1)).toBe(`/blog/${ID}`)
  expect(titleField().value).toBe(`Hello, edited`)

  await pressGoToUsers()
  await click(dialogButton(`Leave`))
  expect(memory.history.at(-1)).toBe(`/users`)
  expect(document.querySelector(`[data-e2e=users-page]`)).not.toBeNull()
})

it(`lets a g shortcut leave at once when nothing is unsaved`, async () => {
  const { memory, pressGoToUsers } = await openEditor()
  expect(titleField().value).toBe(`Hello`)
  await pressGoToUsers()
  expect(document.querySelector(`dialog`)).toBeNull()
  expect(memory.history.at(-1)).toBe(`/users`)
})

it(`asks before an in-app link leaves unsaved edits, and leaves once on Leave`, async () => {
  const { memory } = await openEditor()
  await typeTitle(`Hello, edited`)
  const back = document.querySelector(`a[href="/blog"]`)
  if (!back) throw new Error(`no link back to the list`)

  await click(back)
  expect(document.querySelector(`dialog`)?.textContent).toContain(`Leave without saving?`)
  expect(memory.history.at(-1)).toBe(`/blog/${ID}`)

  await click(dialogButton(`Leave`))
  expect(document.querySelector(`dialog`)).toBeNull()
  expect(memory.history.at(-1)).toBe(`/blog`)
})
