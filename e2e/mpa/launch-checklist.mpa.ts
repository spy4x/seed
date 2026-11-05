// Seed's own site: see docs/start-a-product.md
import { expect, type Page, test } from "@playwright/test"
import { AxeBuilder } from "@axe-core/playwright"

const PATH = "/saas-launch-checklist"
/** The WCAG levels the site promises (docs: design, "Accessibility"). */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]
/** How long Undo stays after Clear ticks (`UNDO_MS` in the island). */
const UNDO_MS = 10_000

/** Every axe-core violation on the page, as `rule: target` lines, so a failure names the element. */
async function axeViolations(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
  return result.violations.flatMap((violation) =>
    violation.nodes.map((node) => `${violation.id}: ${node.target.join(" ")}`)
  )
}

/** The summary once the island has read the boxes: its count line names how many are checked. */
async function summaryReady(page: Page): Promise<void> {
  await expect(page.locator("[data-e2e=checklist-count]")).toContainText("checked")
}

test.describe("with JavaScript", () => {
  test("a tick is counted, survives a reload, and is cleared and undone with focus and an announcement", async ({ page }) => {
    await page.clock.install()
    await page.goto(PATH)
    await summaryReady(page)
    const count = page.locator("[data-e2e=checklist-count]")
    const total = Number((await count.textContent())?.match(/of (\d+)/)?.[1])
    expect(total).toBeGreaterThan(30)
    await expect(count).toHaveText(`0 of ${total} checked`)
    await expect(page.locator("[data-e2e=checklist-storage]")).toHaveText(
      "Your ticks are saved in this browser only. Nothing is sent to us.",
    )

    await page.getByLabel("Restore a backup once, on a fresh server.", { exact: true }).check()
    await page.getByLabel("Publish terms of service.", { exact: true }).check()
    await expect(count).toHaveText(`2 of ${total} checked`)
    await expect(page.locator("[data-checklist-count=backups]")).toHaveText("1 of 3 checked")
    await expect(page.locator("[data-checklist-nav=backups]").first()).toHaveText("1/3")
    // Nothing about the ticks goes into the address.
    expect(page.url()).toMatch(/\/saas-launch-checklist$/)

    await page.reload()
    await summaryReady(page)
    await expect(count).toHaveText(`2 of ${total} checked`)
    await expect(page.getByLabel("Restore a backup once, on a fresh server.", { exact: true }))
      .toBeChecked()

    const live = page.locator("[data-e2e=checklist-live]")
    await page.locator("[data-e2e=checklist-clear]").click()
    await expect(count).toHaveText(`0 of ${total} checked`)
    await expect(live).toHaveText("Ticks cleared.")
    await expect(page.locator("[data-e2e=checklist-undo]")).toBeFocused()

    await page.keyboard.press("Enter")
    await expect(count).toHaveText(`2 of ${total} checked`)
    await expect(live).toHaveText("Ticks restored.")
    await expect(page.locator("[data-e2e=checklist-clear]")).toBeFocused()
    await expect(page.getByLabel("Publish terms of service.", { exact: true })).toBeChecked()
  })

  test("when Undo times out it goes, the live region empties, and focus stays in the list", async ({ page }) => {
    await page.clock.install()
    await page.goto(PATH)
    await summaryReady(page)
    await page.getByLabel("Publish terms of service.", { exact: true }).check()
    await page.locator("[data-e2e=checklist-clear]").click()
    const live = page.locator("[data-e2e=checklist-live]")
    await expect(live).toHaveText("Ticks cleared.")
    await expect(page.locator("[data-e2e=checklist-undo]")).toBeFocused()

    await page.clock.runFor(UNDO_MS)
    await expect(page.locator("[data-e2e=checklist-undo]")).toHaveCount(0)
    await expect(live).toHaveText("")
    await expect(page.locator("#checklist input").first()).toBeFocused()
  })

  test("the page has no WCAG violations with ticks, and Copy link and Print appear", async ({ page }) => {
    await page.goto(PATH)
    await summaryReady(page)
    await page.getByLabel("Publish terms of service.", { exact: true }).check()
    await expect(page.locator("[data-e2e=checklist-copy]")).toBeVisible()
    await expect(page.locator("[data-e2e=checklist-print]")).toBeVisible()
    expect(await axeViolations(page)).toEqual([])
  })
})

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false })

  test("a visitor reads and ticks the whole list, with no buttons that need a script", async ({ page }) => {
    await page.goto(PATH)
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("The SaaS launch checklist")
    await expect(page.locator("[data-e2e=checklist-count]")).toHaveText(/^\d+ items in 9 sections$/)
    await expect(page.locator("[data-e2e=checklist-clear]")).toHaveCount(0)
    await expect(page.locator("[data-e2e=checklist-copy]")).toHaveCount(0)
    await expect(page.locator("[data-e2e=checklist-print]")).toHaveCount(0)

    const box = page.getByLabel("Restore a backup once, on a fresh server.", { exact: true })
    await box.check()
    await expect(box).toBeChecked()
    const proof = page.getByRole("link", { name: "Built into Seed: Restore from a backup" })
    await expect(proof).toHaveAttribute("href", "/docs/restore#rehearse-a-restore")
    expect(await axeViolations(page)).toEqual([])
  })

  test("the Arabic page is right to left, in Arabic, with the same items", async ({ page }) => {
    await page.goto(`/ar${PATH}`)
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl")
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "قائمة التحقق لإطلاق منتج SaaS",
    )
    await expect(page.locator("#backups-restore-tested")).toHaveCount(1)
    expect(await axeViolations(page)).toEqual([])
  })
})
