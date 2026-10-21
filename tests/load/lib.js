// Shared helpers of the k6 scenarios in this folder. k6 runs them, not Deno: `tests/load/run.ts`
// starts the pinned k6 container on the local stack's own network, so `BASE_URL` is always the
// local API container and never a remote host.
import http from "k6/http"
import { sleep } from "k6"

/** The local API, reached on the Compose network: `http://api:8000`. */
export const BASE_URL = __ENV.BASE_URL
/** The web app's origin the API expects on every write (`DOMAIN` of the env file). */
export const ORIGIN = __ENV.ORIGIN

if (!BASE_URL || !ORIGIN) throw new Error(`BASE_URL and ORIGIN are required; run deno task load`)

/** The headers a same-origin page sends, which the API's mutation guards ask for. */
export function pageHeaders(cookie) {
  const headers = {
    "content-type": `application/json`,
    origin: ORIGIN,
    "sec-fetch-site": `same-origin`,
  }
  if (cookie) headers.cookie = cookie
  return headers
}

/** Posts `body` as JSON, signed in as `cookie` when given. */
export function post(path, body, cookie, params = {}) {
  return http.post(`${BASE_URL}${path}`, JSON.stringify(body), {
    ...params,
    headers: pageHeaders(cookie),
  })
}

/**
 * A version 7 UUID, as every id in this product is (docs/ids.md). k6 cannot import the shared
 * library, so this is its algorithm in a few lines: 48 bits of milliseconds, then random bits with
 * the version and variant set.
 */
export function uuidV7() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let ms = Date.now()
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ms % 256
    ms = Math.floor(ms / 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, `0`)).join(``)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${
    hex.slice(20)
  }`
}

/** The subject of the mail that carries a sign-up code (`e2e/fixtures/sign-up.ts`). */
const CODE_SUBJECT = `Your code to confirm your e-mail address`

/** How many sign-ups run at once in {@link signUpUsers}. */
const SIGN_UP_BATCH = 25

/**
 * Signs up `count` throwaway accounts the way a person does and the e2e specs do: the address and
 * password, the code the dev worker mails (read from the development-only `/api/test/last-mail`),
 * then the code. Each account has its own cookie jar, so each ends with its own session.
 *
 * Answers one `{ email, cookie, userId, groupId }` per account; `groupId` is the personal group
 * sign-up creates. Throws when an account cannot be made, so a run never measures a broken setup.
 */
export function signUpUsers(count, prefix) {
  const password = `Load-${prefix}-pass`
  const users = []
  for (let start = 0; start < count; start += SIGN_UP_BATCH) {
    const batch = []
    for (let i = start; i < Math.min(count, start + SIGN_UP_BATCH); i++) {
      batch.push({ email: `load-${prefix}-${i}@example.com`, jar: new http.CookieJar() })
    }
    const requested = http.batch(batch.map(({ email, jar }) => ({
      method: `POST`,
      url: `${BASE_URL}/api/auth/password/sign-up`,
      body: JSON.stringify({ email, password }),
      params: { jar, headers: pageHeaders() },
    })))
    requested.forEach((response, i) => {
      if (response.status !== 200) {
        throw new Error(`sign-up of ${batch[i].email}: ${response.status} ${response.body}`)
      }
    })
    const codes = batch.map(({ email }) => waitForCode(email))
    const verified = http.batch(batch.map(({ jar }, i) => ({
      method: `POST`,
      url: `${BASE_URL}/api/auth/password/sign-up/verify`,
      body: JSON.stringify({ code: codes[i] }),
      params: { jar, headers: pageHeaders() },
    })))
    verified.forEach((response, i) => {
      const { email, jar } = batch[i]
      if (response.status !== 200) {
        throw new Error(`sign-up code of ${email}: ${response.status} ${response.body}`)
      }
      const cookies = jar.cookiesForURL(BASE_URL)
      const cookie = Object.entries(cookies).map(([name, values]) => `${name}=${values[0]}`)
        .join(`; `)
      const selected = http.get(`${BASE_URL}/api/groups/selected`, { headers: pageHeaders(cookie) })
      const groupId = selected.status === 200 ? selected.json(`groupId`) : null
      if (!groupId) throw new Error(`no personal group for ${email}: ${selected.status}`)
      users.push({ email, cookie, userId: response.json(`id`), groupId })
    })
  }
  return users
}

/** Polls the development mail route until the sign-up code for `email` arrives (20 s at most). */
function waitForCode(email) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const response = post(`/api/test/last-mail`, { email })
    if (response.status === 200 && response.json(`subject`) === CODE_SUBJECT) {
      return String(response.json(`text`)).split(`\n\n`)[1].trim()
    }
    sleep(0.25)
  }
  throw new Error(`no sign-up code mail for ${email} in 20 s: is the worker running?`)
}

/** Deletes the accounts {@link signUpUsers} made, with everything they wrote (dev route). */
export function deleteUsers(users) {
  for (let start = 0; start < users.length; start += SIGN_UP_BATCH) {
    http.batch(
      users.slice(start, start + SIGN_UP_BATCH).map(({ email }) => ({
        method: `POST`,
        url: `${BASE_URL}/api/test/cleanup-user`,
        body: JSON.stringify({ login: email }),
        params: { headers: pageHeaders() },
      })),
    )
  }
}

/** Creates a note in `groupId` and answers the response; 201 when it was made. */
export function createNote(user, title, params = {}) {
  return post(
    `/api/groups/${user.groupId}/notes`,
    { id: uuidV7(), title, body: `Written by the load test. `.repeat(8) },
    user.cookie,
    params,
  )
}

/**
 * Logs where the run is, so `run.ts` samples Postgres only while the scenario itself runs: call it
 * with `measure` at the end of `setup()` and with `teardown` at the start of `teardown()`.
 */
export function markPhase(name) {
  console.log(`LOAD_PHASE ${name}`)
}

/** A short run prefix, so two runs never share an address. */
export function runPrefix() {
  return Date.now().toString(36)
}

/**
 * The summary `run.ts` reads: one JSON line per scenario with the request count, p95 and error
 * rate of that scenario's own requests (setup and teardown are not in them), plus any extra
 * metrics a scenario names.
 */
export function compactSummary(data, scenario, extra = []) {
  const metric = (name) => data.metrics[name]?.values
  const duration = metric(`http_req_duration{scenario:${scenario}}`)
  const failed = metric(`http_req_failed{scenario:${scenario}}`)
  const result = {
    scenario,
    requests: metric(`http_reqs{scenario:${scenario}}`)?.count ?? 0,
    p95Ms: duration?.[`p(95)`] ?? null,
    medianMs: duration?.med ?? null,
    errorRate: failed?.rate ?? null,
  }
  for (const name of extra) result[name] = metric(name) ?? null
  return { stdout: `LOAD_SUMMARY ${JSON.stringify(result)}\n` }
}
