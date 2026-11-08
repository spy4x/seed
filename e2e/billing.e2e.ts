import { type Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { signIn } from "./fixtures/app.ts"
import { BILLING_WEBHOOK_PATH, stripeSignature, subscriptionEvent } from "./fixtures/billing.ts"
import { createGroup, openGroupTab } from "./fixtures/groups.ts"
import { signUpWithCode } from "./fixtures/sign-up.ts"

const apiBase = "http://app.localhost"
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }

/**
 * The trial a new person gets, in days: the longest trial of any plan in the catalog the stack
 * runs, 0 when no plan has one. Read from the API, so a product that changes its plans keeps
 * these specs.
 */
async function trialDays(page: Page): Promise<number> {
  const response = await page.request.get(`${apiBase}/api/billing/trial`)
  expect(response.status(), await response.text()).toBe(200)
  const { trial } = await response.json()
  expect(trial.enabled).toBe(true)
  return trial.days
}

// These specs check out from the free plan, so their sign-ups and groups keep it.
test.describe("group billing", () => {
  test("the owner checks out a group's paid plan, with the catalog's trial, and the page shows it once the signed webhook arrives", async ({ page, request }) => {
    const email = "e2e_billing_owner@example.com"
    const password = "Passw0rd!"
    const cleanup = async ({ soft = false } = {}) => {
      const response = await request.post(`${apiBase}/api/test/cleanup-user`, {
        data: { login: email },
      })
      ;(soft ? expect.soft : expect)(response.status(), await response.text()).toBe(200)
    }

    await cleanup()
    try {
      const signUp = await signUpWithCode(request, `${apiBase}/api/auth/password/sign-up`, {
        headers,
        data: { email, password },
      }, { keepFree: true })
      expect(signUp.ok()).toBe(true)
      await signIn(page, email, password)
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")

      await page.getByRole("navigation", { name: "Main navigation" })
        .getByRole("link", { name: "Groups" }).click()
      await createGroup(page, "Club", { keepFree: true })
      const groupId = new URL(page.url()).pathname.replace("/groups/", "")
      await openGroupTab(page, "Billing")
      const plan = page.locator("[data-e2e=billing-plan]")
      await expect(plan).toHaveAttribute("data-plan", "free")
      const days = await trialDays(page)

      // The development provider's checkout is no page of its own: it sends the browser straight
      // back to the checkout's success URL, the Billing tab, as Stripe does once paid.
      const checkout = page.locator("[data-e2e=billing-checkout]")
      if (days > 0) {
        await expect(checkout).toHaveAccessibleName(`Start ${days}-day free trial (opens Stripe)`)
      }
      await checkout.click()
      // The tab drops the success URL's query, so a reload does not say it again.
      await expect(page).toHaveURL(`/groups/${groupId}/billing`)
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
      await expect(plan).toHaveAttribute("data-plan", "free")
      await expect(page.locator("[data-e2e=billing-confirming]")).toBeVisible()
      // While Stripe confirms, a second checkout could be paid twice: none is offered.
      await expect(page.locator("[data-e2e=billing-checkout]")).toHaveCount(0)

      const body = subscriptionEvent({
        reference: groupId,
        status: days > 0 ? "trialing" : "active",
      })
      const delivered = await request.post(`${apiBase}${BILLING_WEBHOOK_PATH}`, {
        headers: {
          "content-type": "application/json",
          "stripe-signature": await stripeSignature(body),
        },
        data: body,
      })
      expect(delivered.status(), await delivered.text()).toBe(200)

      // No reload: the plan change reaches the open page through the group's change hint.
      await expect(plan).toHaveAttribute("data-plan", "pro")
      await expect(page.locator("[data-e2e=billing-upgraded]"))
        .toContainText(days > 0 ? new RegExp(`Your ${days}-day .+ trial has started`) : "You’re on")
      await expect(page.getByRole("button", { name: "Change card (opens Stripe)" })).toBeVisible()

      const replayed = await request.post(`${apiBase}${BILLING_WEBHOOK_PATH}`, {
        headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=00" },
        data: body,
      })
      expect(replayed.status()).toBe(400)
    } finally {
      await cleanup({ soft: true })
    }
  })

  test("the create-group page offers the person's trial until a group's checkout takes it, and none when no plan has one", async ({ page, request }) => {
    const email = "e2e_billing_trial@example.com"
    const password = "Passw0rd!"
    const cleanup = async ({ soft = false } = {}) => {
      const response = await request.post(`${apiBase}/api/test/cleanup-user`, {
        data: { login: email },
      })
      ;(soft ? expect.soft : expect)(response.status(), await response.text()).toBe(200)
    }

    await cleanup()
    try {
      const signUp = await signUpWithCode(request, `${apiBase}/api/auth/password/sign-up`, {
        headers,
        data: { email, password },
      }, { keepFree: true })
      expect(signUp.ok()).toBe(true)
      await signIn(page, email, password)
      const groups = page.getByRole("navigation", { name: "Main navigation" })
        .getByRole("link", { name: "Groups" })
      const trial = page.locator("[data-e2e=group-trial]")

      const days = await trialDays(page)
      await groups.click()
      await page.locator("[data-e2e=group-new]").click()
      if (days === 0) {
        await expect(page.locator("[data-e2e=group-name]")).toBeVisible()
        await expect(trial).toHaveCount(0)
        return
      }
      await expect(trial).toContainText(`Your ${days}-day free trial goes to`)
      await page.locator("[data-e2e=group-name]").fill("First")
      await page.locator("[data-e2e=group-create]").click()
      await expect(page).toHaveURL(/\/groups\/[0-9a-f-]{36}$/)
      const groupId = new URL(page.url()).pathname.replace("/groups/", "")

      await openGroupTab(page, "Billing")
      await page.getByRole("button", { name: `Start ${days}-day free trial (opens Stripe)` })
        .click()
      // The tab is on this address before the checkout too: wait for the return to land.
      await expect(page.locator("[data-e2e=billing-confirming]")).toBeVisible()
      await expect(page).toHaveURL(`/groups/${groupId}/billing`)

      await groups.click()
      await page.locator("[data-e2e=group-new]").click()
      await expect(trial).toContainText("You've already used your free trial")
    } finally {
      await cleanup({ soft: true })
    }
  })
})
