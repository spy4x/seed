import { expect, test } from "./fixtures/stack.ts"
import { gotoApp } from "./fixtures/app.ts"
import { CODE_SUBJECTS, lastMail } from "./fixtures/sign-up.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"

/**
 * E-mails in the reader's language (#277): the sign-up code goes out before any account exists,
 * so it is written in the language the page shows, which the SPA sends with the sign-up. One mail
 * per language lands in the development mailbox (`dev_mail`). The other mails, their dates and
 * the Arabic direction are covered by `libs/server/mail/mail.test.ts`.
 */

const appBase = "http://app.localhost"
const lastMailUrl = `${appBase}/api/test/last-mail`

test("the sign-up code arrives in the language the sign-up page shows, for each of the six", async ({ browser, request }) => {
  test.setTimeout(120_000)
  for (const [language, subject] of Object.entries(CODE_SUBJECTS)) {
    // A fresh address per language: each sign-up spends one of the address's code mails.
    const email = `e2e-mail-${language.toLowerCase()}-${uuidV7().slice(-8)}@example.com`
    const context = await browser.newContext({ baseURL: appBase, locale: `en-GB` })
    try {
      await context.addInitScript((kept) => localStorage.setItem(`language`, kept), language)
      const page = await context.newPage()
      await gotoApp(page, `/sign-up`, page.locator(`[data-e2e=auth-form-login]`))
      await expect(page.locator(`html`)).toHaveAttribute(`lang`, language)
      await page.locator(`[data-e2e=auth-form-login]`).fill(email)
      await page.locator(`[data-e2e=auth-form-password]`).fill(`Passw0rd!`)
      await page.locator(`[data-e2e=auth-form-submit]`).click()

      await expect.poll(async () => (await lastMail(request, lastMailUrl, email))?.subject, {
        timeout: 20_000,
        message: `the worker mails the ${language} sign-up code to ${email}`,
      }).toBe(subject)
    } finally {
      await context.close()
      await request.post(`${appBase}/api/test/cleanup-user`, { data: { login: email } })
    }
  }
})
