/// <reference lib="deno.ns" />
/**
 * `deno task linkedin:sign-in`: signs the owner in to LinkedIn once, so the worker can post blog
 * posts to their profile (docs/blog.md, "LinkedIn"). It opens nothing by itself: it prints the
 * sign-in address, waits for LinkedIn to send the browser back to `http://localhost:<port>/callback`,
 * trades the code for an access token and prints the three env lines the server needs. The token
 * lasts 60 days; run this again before the admin's warning runs out.
 *
 * Reads `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET` (the LinkedIn app's, with
 * `http://localhost:8789/callback` among its redirect URLs) and the optional
 * `LINKEDIN_REDIRECT_PORT`. Nothing is written to disk.
 */
import {
  exchangeLinkedinCode,
  linkedinAuthorizeUrl,
  type LinkedinTokens,
  readLinkedinMember,
} from "@spy4x/integrations/linkedin"
import { randomBase64Url } from "@spy4x/platform/tokens"

/** The port the callback listens on unless `LINKEDIN_REDIRECT_PORT` names another. */
export const LINKEDIN_REDIRECT_PORT = 8789

/** How long the script waits for the owner to sign in. */
const WAIT_MS = 10 * 60 * 1000

/** What the callback LinkedIn sent the browser to says: the code, or why there is none. */
export function callbackCode(url: URL, state: string): { code: string } | { problem: string } {
  const error = url.searchParams.get(`error`)
  if (error !== null) {
    return { problem: `LinkedIn refused: ${url.searchParams.get(`error_description`) ?? error}` }
  }
  if (url.searchParams.get(`state`) !== state) {
    return { problem: `the callback's state does not match this sign-in; start again` }
  }
  const code = url.searchParams.get(`code`)
  return code ? { code } : { problem: `the callback has no code; start again` }
}

/** The env lines to paste into the server's env file. */
export function envLines(tokens: Pick<LinkedinTokens, `accessToken` | `expiresAt`>, sub: string) {
  return [
    `LINKEDIN_ACCESS_TOKEN=${tokens.accessToken}`,
    `LINKEDIN_TOKEN_EXPIRES_AT=${tokens.expiresAt}`,
    `LINKEDIN_MEMBER_ID=${sub}`,
  ]
}

function required(name: string): string {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`${name} is not set. docs/blog.md, "LinkedIn", says where it comes from.`)
  return value
}

async function main(): Promise<void> {
  const clientId = required(`LINKEDIN_CLIENT_ID`)
  const clientSecret = required(`LINKEDIN_CLIENT_SECRET`)
  const port = Number(Deno.env.get(`LINKEDIN_REDIRECT_PORT`) ?? LINKEDIN_REDIRECT_PORT)
  const redirectUri = `http://localhost:${port}/callback`
  const state = randomBase64Url(32)

  const stop = new AbortController()
  const timer = setTimeout(() => stop.abort(), WAIT_MS)
  const code = await new Promise<string>((resolve, reject) => {
    stop.signal.addEventListener(`abort`, () => reject(new Error(`no sign-in within 10 minutes`)))
    Deno.serve({ hostname: `127.0.0.1`, port, signal: stop.signal, onListen: () => {} }, (req) => {
      const url = new URL(req.url)
      if (url.pathname !== `/callback`) return new Response(`Not found`, { status: 404 })
      const answer = callbackCode(url, state)
      if (`problem` in answer) {
        reject(new Error(answer.problem))
        return new Response(answer.problem, { status: 400 })
      }
      resolve(answer.code)
      return new Response(`Signed in. You can close this tab and go back to the terminal.`)
    })
    console.log(`Open this address and sign in to LinkedIn:\n\n${
      linkedinAuthorizeUrl({ clientId, redirectUri, state })
    }\n`)
  }).finally(() => {
    clearTimeout(timer)
    stop.abort()
  })

  const tokens = await exchangeLinkedinCode({ clientId, clientSecret, redirectUri, code })
  if (!tokens.success) throw new Error(tokens.error)
  const member = await readLinkedinMember({ accessToken: tokens.output.accessToken })
  if (!member.success) throw new Error(member.error)
  console.log(`Put these lines in the server's env file (infra/envs/.env.prod), then deploy:\n`)
  for (const line of envLines(tokens.output, member.output.sub)) console.log(line)
}

if (import.meta.main) await main()
