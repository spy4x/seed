import { expect, test } from "./fixtures/stack.ts"
import { gotoApp, signIn } from "./fixtures/app.ts"
import { signUpWithCode } from "./fixtures/sign-up.ts"

const apiBase = "http://app.localhost"
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }

test.describe("profile over the socket", () => {
  test("a name saved in one tab appears in a second tab without a reload", async ({ context, request }) => {
    const email = "e2e_profile_two_tabs_user@example.com"
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

      // Two pages of one context hold the same session cookie, as two tabs of one person do.
      const first = await context.newPage()
      const framesSent: string[] = []
      first.on("websocket", (socket) => {
        socket.on("framesent", (frame) => framesSent.push(String(frame.payload)))
      })
      const profileWrites: string[] = []
      first.on("request", (req) => {
        if (req.method() === "PATCH" && new URL(req.url()).pathname === "/api/users/me") {
          profileWrites.push(req.url())
        }
      })
      await signIn(first, email, password)
      await first.getByRole("navigation", { name: "Main navigation" })
        .getByRole("link", { name: "Profile" }).click()
      await expect(first.getByRole("heading", { level: 1, name: "Profile" })).toBeVisible()

      const second = await context.newPage()
      // What tab 2 sends and receives. Its first `profile.get` may go out while the socket is still
      // connecting and be sent again a second later, so the spec waits for an answer to one.
      const profileGets = new Set<string>()
      let profileGetAnswered = false
      const hintsReceived: { groupId: string; aggregate: string }[] = []
      second.on("websocket", (socket) => {
        socket.on("framesent", (frame) => {
          const message = JSON.parse(String(frame.payload))
          if (message.kind === "client.query" && message.name === "profile.get") {
            profileGets.add(message.id)
          }
        })
        socket.on("framereceived", (frame) => {
          const message = JSON.parse(String(frame.payload))
          if (message.kind === "server.result" && profileGets.has(message.requestId)) {
            profileGetAnswered = true
          }
          if (message.kind === "change.hint") hintsReceived.push(message)
        })
      })
      // Tab 2's socket can be dropped and held down, which a page-wide offline switch could not do
      // without also cutting tab 1.
      let socketBlocked = false
      const openSockets: { close(): void }[] = []
      await second.routeWebSocket(/\/api\/ws$/, (route) => {
        if (socketBlocked) {
          route.close()
          return
        }
        route.connectToServer()
        openSockets.push(route)
      })
      await gotoApp(second, "/", second.locator("[data-e2e=shell-ws-status]"))
      await second.getByRole("navigation", { name: "Main navigation" })
        .getByRole("link", { name: "Profile" }).click()
      await expect(second.getByRole("heading", { level: 1, name: "Profile" })).toBeVisible()
      await expect(second.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
      await expect(first.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")

      await expect.poll(() => profileGetAnswered).toBe(true)

      await first.locator("[data-e2e=profile-edit]").click()
      await first.locator("[data-e2e=profile-first-name]").fill("Ada")
      await first.locator("[data-e2e=profile-last-name]").fill("Lovelace")
      await first.locator("[data-e2e=profile-save]").click()
      await first.locator("[data-e2e=profile-saved]").getByText("Saved", { exact: true }).waitFor()

      // The second tab was neither reloaded nor touched: the server's hint made it read again.
      await expect(second.locator("[data-e2e=profile-name]")).toHaveText("Ada Lovelace")

      // The server sent tab 2 the hint for this person's own changes, and the tab acted on it.
      expect(
        hintsReceived.some((hint) => /^user:\d+$/.test(hint.groupId) && hint.aggregate === "user"),
      )
        .toBe(true)

      // A change made while tab 2's socket is down gives it no hint; it reads the profile again
      // once the socket opens.
      socketBlocked = true
      for (const route of openSockets) route.close()
      await expect(second.locator("[data-e2e=shell-ws-status]")).not.toHaveText("Online")
      // The first save's notice closes on its own five seconds after it opened. While it is still
      // open, the second save's notice makes the "Saved" text below match twice.
      await expect(first.locator("[data-e2e=profile-saved]")).toHaveCount(0, { timeout: 10_000 })
      await first.locator("[data-e2e=profile-edit]").click()
      await first.locator("[data-e2e=profile-first-name]").fill("Grace")
      await first.locator("[data-e2e=profile-save]").click()
      await first.locator("[data-e2e=profile-saved]").getByText("Saved", { exact: true }).waitFor()
      await expect(second.locator("[data-e2e=profile-name]")).toHaveText("Ada Lovelace")
      socketBlocked = false
      await expect(second.locator("[data-e2e=profile-name]")).toHaveText("Grace Lovelace", {
        timeout: 30_000,
      })

      // The first save went over the socket, as a command with an idempotency key, not over REST.
      const command = framesSent.map((payload) => JSON.parse(payload)).find(
        (frame) => frame.kind === "client.command" && frame.name === "profile.update",
      )
      expect(command?.idempotencyKey).toBeTruthy()
      expect(command?.payload).toEqual({ firstName: "Ada", lastName: "Lovelace" })
      expect(profileWrites).toEqual([])
    } finally {
      await cleanup({ soft: true })
    }
  })
})
