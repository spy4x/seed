import { expect, test } from "./fixtures/stack.ts"
import { gotoApp, signIn } from "./fixtures/app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { createGroup } from "./fixtures/groups.ts"
import { signUpWithCode } from "./fixtures/sign-up.ts"

const apiBase = "http://app.localhost"
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }

test.describe("groups over the socket", () => {
  test("creates over the socket and catches up after a dropped connection", async ({ page, request }) => {
    const email = "e2e_groups_socket_user@example.com"
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
      })
      expect(signUp.ok()).toBe(true)

      // What the page sends: socket frames, and REST calls that write groups.
      const framesSent: string[] = []
      page.on("websocket", (socket) => {
        socket.on("framesent", (frame) => framesSent.push(String(frame.payload)))
      })
      const groupWrites: string[] = []
      page.on("request", (req) => {
        if (req.method() === "POST" && new URL(req.url()).pathname === "/api/groups") {
          groupWrites.push(req.url())
        }
      })

      await signIn(page, email, password)

      const nav = page.getByRole("navigation", { name: "Main navigation" })
      await nav.getByRole("link", { name: "Groups" }).click()
      await expect(page.getByRole("heading", { level: 1, name: "Groups" })).toBeVisible()
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")

      // The signed-up user starts with a personal group.
      const names = page.locator("[data-e2e=group-item-name]")
      await expect(names).toHaveCount(1)

      await createGroup(page, "Trip")
      await page.goBack()
      await expect(names.filter({ hasText: "Trip" })).toHaveCount(1)

      // The create went over the socket, as a command with an idempotency key.
      const command = framesSent.map((payload) => JSON.parse(payload)).find(
        (frame) => frame.kind === "client.command" && frame.name === "group.create",
      )
      expect(command?.idempotencyKey).toBeTruthy()
      expect(groupWrites).toEqual([])

      // Lose the connection, and create a group behind the page's back while it is down.
      await page.context().setOffline(true)
      const closed = await request.post(`${apiBase}/api/test/close-sockets`, {
        data: { login: email },
      })
      expect(closed.status(), await closed.text()).toBe(200)
      const behindItsBack = await page.request.post(`${apiBase}/api/groups`, {
        headers,
        data: { id: uuidV7(), name: "Made while offline" },
      })
      expect(behindItsBack.status()).toBe(201)
      await expect(names.filter({ hasText: "Made while offline" })).toHaveCount(0)

      // Back online, the reconnect pulls and the list catches up without a reload.
      await page.context().setOffline(false)
      await expect(names.filter({ hasText: "Made while offline" })).toHaveCount(1, {
        timeout: 20_000,
      })
      await expect(names).toHaveCount(3)
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
    } finally {
      await page.context().setOffline(false)
      await cleanup({ soft: true })
    }
  })

  test("refuses the socket upgrade after sign-out", async ({ page, request }) => {
    const email = "e2e_groups_socket_signout@example.com"
    const password = "Passw0rd!"
    await request.post(`${apiBase}/api/test/cleanup-user`, { data: { login: email } })
    try {
      const signUp = await signUpWithCode(request, `${apiBase}/api/auth/password/sign-up`, {
        headers,
        data: { email, password },
      })
      expect(signUp.ok()).toBe(true)

      await signIn(page, email, password)
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")

      await page.locator("[data-e2e=account-menu-button]").click()
      await page.getByRole("menuitem", { name: "Sign out" }).click()
      await page.locator("[data-e2e=auth-form-login]").waitFor()

      // The session is gone, so the upgrade is refused: 401, not a socket.
      const upgrade = await page.request.get(`${apiBase}/api/ws`, {
        headers: { connection: "upgrade", upgrade: "websocket", origin: apiBase },
      })
      expect(upgrade.status()).toBe(401)
    } finally {
      await request.post(`${apiBase}/api/test/cleanup-user`, { data: { login: email } })
    }
  })
  test("signing out in one tab signs the other tab out within seconds", async ({ page, request }) => {
    const email = "e2e_groups_socket_twotabs@example.com"
    const password = "Passw0rd!"
    await request.post(`${apiBase}/api/test/cleanup-user`, { data: { login: email } })
    try {
      const signUp = await signUpWithCode(request, `${apiBase}/api/auth/password/sign-up`, {
        headers,
        data: { email, password },
      })
      expect(signUp.ok()).toBe(true)

      await signIn(page, email, password)
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")

      // A second tab of the same browser shares the session cookie and opens its own socket.
      const other = await page.context().newPage()
      await gotoApp(other, "/notes", other.locator("[data-e2e=shell-ws-status]"))
      await expect(other.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")

      await page.locator("[data-e2e=account-menu-button]").click()
      await page.getByRole("menuitem", { name: "Sign out" }).click()
      await page.locator("[data-e2e=auth-form-login]").waitFor()

      // The API closes the other tab's socket when the session ends, so it does not have to wait
      // for the 15 second sweep.
      await expect(other.locator("[data-e2e=auth-form-login]")).toBeVisible({ timeout: 5_000 })
    } finally {
      await request.post(`${apiBase}/api/test/cleanup-user`, { data: { login: email } })
    }
  })
  test("a group created in one tab appears in the other tab without a reload or reconnect", async ({ page, request }) => {
    const email = "e2e_groups_socket_live@example.com"
    const password = "Passw0rd!"
    await request.post(`${apiBase}/api/test/cleanup-user`, { data: { login: email } })
    try {
      const signUp = await signUpWithCode(request, `${apiBase}/api/auth/password/sign-up`, {
        headers,
        data: { email, password },
      })
      expect(signUp.ok()).toBe(true)

      await signIn(page, email, password)

      // The second tab counts the sockets it opens and the documents it loads, so a reconnect or
      // a reload, which would pull the list on its own, fails the test instead of passing it.
      const other = await page.context().newPage()
      let otherSockets = 0
      other.on("websocket", (socket) => {
        // Vite's dev server opens its own socket; only the app's one counts.
        if (new URL(socket.url()).pathname === "/api/ws") otherSockets++
      })
      let otherLoads = 0
      other.on("load", () => otherLoads++)
      await gotoApp(other, "/groups", other.locator("[data-e2e=shell-ws-status]"))
      await expect(other.getByRole("heading", { level: 1, name: "Groups" })).toBeVisible()
      await expect(other.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
      const otherNames = other.locator("[data-e2e=group-item-name]")
      await expect(otherNames).toHaveCount(1)
      // A load that a network change broke is made again, so the counts start from here.
      const settled = { otherSockets, otherLoads }
      expect(settled.otherSockets).toBeGreaterThan(0)

      await gotoApp(page, "/groups", page.locator("[data-e2e=shell-ws-status]"))
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
      await createGroup(page, "Seen live")

      // Only the worker's announcement, turned into a hint on the socket, can bring it here.
      await expect(otherNames.filter({ hasText: "Seen live" })).toHaveCount(1, { timeout: 3_000 })
      expect({ otherSockets, otherLoads }).toEqual(settled)
    } finally {
      await request.post(`${apiBase}/api/test/cleanup-user`, { data: { login: email } })
    }
  })
  test("a periodic sweep signs a tab out when its user is removed", async ({ page, request }) => {
    // No sign-out event fires here, so only the 15 second revalidation can close the socket.
    test.setTimeout(60_000)
    const email = "e2e_groups_socket_sweep@example.com"
    const password = "Passw0rd!"
    await request.post(`${apiBase}/api/test/cleanup-user`, { data: { login: email } })
    try {
      const signUp = await signUpWithCode(request, `${apiBase}/api/auth/password/sign-up`, {
        headers,
        data: { email, password },
      })
      expect(signUp.ok()).toBe(true)

      await signIn(page, email, password)
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")

      await request.post(`${apiBase}/api/test/cleanup-user`, { data: { login: email } })

      await expect(page.locator("[data-e2e=auth-form-login]")).toBeVisible({ timeout: 30_000 })
    } finally {
      await request.post(`${apiBase}/api/test/cleanup-user`, { data: { login: email } })
    }
  })
})
