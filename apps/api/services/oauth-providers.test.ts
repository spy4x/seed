/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { enabledOAuthProviders } from "./oauth-providers.ts"

const BOTH = { clientId: `test-client-id`, clientSecret: `test-client-secret` }

Deno.test("a provider is on only when both its client id and secret are set", () => {
  expect(enabledOAuthProviders({}).map((provider) => provider.id)).toEqual([])
  expect(enabledOAuthProviders({ google: BOTH }).map((provider) => provider.id))
    .toEqual([`google`])
  expect(enabledOAuthProviders({ github: BOTH, google: BOTH }).map((provider) => provider.id))
    .toEqual([`google`, `github`])
})

Deno.test("a provider given only half of its credentials, or blank ones, is off", () => {
  const halves = [
    { clientId: `test-client-id` },
    { clientSecret: `test-client-secret` },
    { clientId: ``, clientSecret: `test-client-secret` },
    { clientId: `test-client-id`, clientSecret: `   ` },
  ]
  for (const half of halves) {
    expect(enabledOAuthProviders({ google: half, github: half })).toEqual([])
  }
})

Deno.test("an enabled provider carries the credentials it was given", () => {
  const [github] = enabledOAuthProviders({ github: BOTH })

  expect([github.clientId, github.clientSecret]).toEqual([BOTH.clientId, BOTH.clientSecret])
})
