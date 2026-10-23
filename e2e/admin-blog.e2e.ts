import type { BrowserContext, Page } from "@playwright/test"
import { AxeBuilder } from "@axe-core/playwright"
import { expect, test } from "./fixtures/stack.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { signUpWithCode } from "./fixtures/sign-up.ts"

/**
 * The blog's admin pages (#396): an operator writes a post from the keyboard, previews it as the
 * public page renders it, schedules it, publishes it now, finds it on the list and deletes it.
 */

const appBase = "http://app.localhost"
const adminBase = "http://admin.localhost"
const headers = { origin: appBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"
const OPERATOR = 2

/** Signs up an operator and signs them in on the admin host; answers the admin page. */
async function operatorPage(
  browser: import("@playwright/test").Browser,
  request: import("@playwright/test").APIRequestContext,
): Promise<{ admin: BrowserContext; ops: Page }> {
  const email = `e2e-admin-blog-${uuidV7().slice(-8)}@example.com`
  const signUp = await signUpWithCode(request, `${appBase}/api/auth/password/sign-up`, {
    headers,
    data: { email, password },
  })
  expect(signUp.ok(), await signUp.text()).toBe(true)
  expect((await request.post(`${appBase}/api/auth/sign-out`, { headers })).ok()).toBe(true)
  const promoted = await request.post(`${appBase}/api/test/set-role`, {
    data: { login: email, role: OPERATOR },
  })
  expect(promoted.ok(), await promoted.text()).toBe(true)
  const admin = await browser.newContext({ baseURL: adminBase })
  const ops = await admin.newPage()
  await ops.goto(`${adminBase}/sign-in`)
  await ops.locator("[data-e2e=auth-form-login]").fill(email)
  await ops.locator("[data-e2e=auth-form-password]").fill(password)
  await ops.locator("[data-e2e=auth-form-submit]").click()
  await expect(ops).toHaveURL(`${adminBase}/`)
  return { admin, ops }
}

test("an operator writes, previews, schedules, publishes and deletes a post from the keyboard", async ({ browser, request }) => {
  let admin: BrowserContext | null = null
  try {
    const signedIn = await operatorPage(browser, request)
    admin = signedIn.admin
    const ops = signedIn.ops
    const title = `Keyboard post ${uuidV7().slice(-6)}`
    const slug = title.toLowerCase().replaceAll(" ", "-")

    // g p opens the blog, c the create page.
    await ops.keyboard.press("g")
    await ops.keyboard.press("p")
    await expect(ops).toHaveURL(`${adminBase}/blog`)
    await expect(ops.locator("[data-e2e=admin-blog-title]")).toHaveText("Blog")
    await ops.keyboard.press("c")
    await expect(ops).toHaveURL(`${adminBase}/blog/new`)

    // The title gives the slug; Ctrl S saves, and the page moves to the post's own address.
    await ops.locator("[data-e2e=admin-blog-title-field]").fill(title)
    await expect(ops.locator("[data-e2e=admin-blog-slug]")).toHaveValue(slug)
    await ops.locator("[data-e2e=admin-blog-body]").fill(
      "## Why\n\nIt is **fast**.\n\n<script>window.hacked = true</script>",
    )
    await ops.locator("[data-e2e=admin-blog-description]").fill("A post written from the keys.")
    await ops.getByRole("button", { name: "Add point" }).click()
    await ops.getByLabel("Key point 1", { exact: true }).fill("Written from the keys")

    // A `g` shortcut with unsaved text asks first; "Keep editing" keeps the page and the text.
    await ops.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await ops.keyboard.press("g")
    await ops.keyboard.press("u")
    const leave = ops.getByRole("alertdialog", { name: "Leave without saving?" })
    await expect(leave).toBeVisible()
    await leave.getByRole("button", { name: "Keep editing" }).click()
    await expect(leave).toBeHidden()
    await expect(ops).toHaveURL(`${adminBase}/blog/new`)
    await expect(ops.locator("[data-e2e=admin-blog-title-field]")).toHaveValue(title)

    // Ctrl S from the end of the body; the words typed after it land in the body, after the
    // page moved to the post's own address.
    const body = ops.locator("[data-e2e=admin-blog-body]")
    await body.click()
    await ops.keyboard.press("ControlOrMeta+End")
    await ops.keyboard.press("ControlOrMeta+s")
    await expect(ops.locator("[data-e2e=admin-blog-saved]")).toHaveText("Saved")
    await expect(ops).toHaveURL(/\/blog\/[0-9a-f-]{36}$/)
    await expect(body).toBeFocused()
    await ops.keyboard.type("\n\nMore after the save.")
    await expect(body).toHaveValue(/<\/script>\n\nMore after the save\.$/)

    // The preview is the API's render: the Markdown is HTML, the raw script stays text.
    await ops.getByRole("tab", { name: "Preview" }).click()
    const preview = ops.locator("[data-e2e=admin-blog-preview]")
    await expect(preview.locator("strong")).toHaveText("fast")
    await expect(preview.getByRole("heading", { level: 2, name: "Why" })).toBeVisible()
    await expect(preview.getByRole("heading", { level: 2, name: title })).toBeVisible()
    await expect(preview.getByRole("heading", { level: 3, name: "In short" })).toBeVisible()
    // The page's outline and the rest of axe-core's checks hold on the Preview tab.
    const axe = await new AxeBuilder({ page: ops })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
      .analyze()
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`))
      .toEqual([])
    await expect(preview.locator("script")).toHaveCount(0)
    expect(await ops.evaluate(() => (globalThis as { hacked?: boolean }).hacked)).toBeUndefined()

    // Scheduled for a time ahead.
    await ops.locator("[data-e2e=admin-blog-publish]").click()
    await ops.getByRole("radio", { name: "At a time" }).check()
    await ops.getByLabel("Date and time").fill("2031-03-04T10:00")
    await ops.getByRole("button", { name: "Schedule" }).click()
    await expect(ops.locator("[data-e2e=toasts]")).toContainText("Scheduled for")
    await expect(ops.locator("[data-e2e=admin-blog-publishing]")).toContainText("Goes live")
    // "Publish…" is gone with the draft, so focus goes to the page's title, not to the page.
    await expect(ops.locator("[data-e2e=admin-blog-editor-title]")).toBeFocused()

    // Published now from More actions; the slug is locked from then on.
    await ops.locator("[data-e2e=admin-blog-menu]").click()
    await ops.locator("[data-e2e=admin-blog-publish-now]").click()
    await ops.getByRole("button", { name: "Publish", exact: true }).click()
    await expect(ops.locator("[data-e2e=toasts]")).toContainText("Published.")
    await expect(ops.locator("[data-e2e=admin-blog-slug]")).toHaveAttribute("readonly", "")
    const live = await request.get(`${appBase}/api/blog/posts/${slug}`)
    expect(live.status()).toBe(200)

    // The list shows it as published; the search finds it by its slug.
    await ops.locator(`a[href="/blog"]`).first().click()
    await ops.locator("[data-e2e=admin-blog-search]").fill(slug)
    await ops.keyboard.press("Enter")
    const rows = ops.locator("[data-e2e=admin-blog-list] tbody tr")
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText("Published")

    // Deleted after a confirmation that names it; the website no longer has it.
    await ops.locator("[data-e2e=admin-blog-row]").click()
    await ops.locator("[data-e2e=admin-blog-menu]").click()
    await ops.locator("[data-e2e=admin-blog-delete]").click()
    await expect(ops.getByRole("alertdialog")).toContainText(`Delete "${title}"?`)
    await ops.getByRole("button", { name: "Delete post" }).click()
    await expect(ops).toHaveURL(`${adminBase}/blog`)
    await expect(ops.locator("[data-e2e=toasts]")).toContainText("Post deleted.")
    expect((await request.get(`${appBase}/api/blog/posts/${slug}`)).status()).toBe(404)
  } finally {
    await admin?.close()
  }
})
