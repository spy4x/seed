// One person in one large group, built first with `deno task load:group <tier>`: each iteration
// reads the whole group through the changes pull as the SPA does after a fresh sign-in, then one
// page of the notes list, three searches, one write and the pull of that one change. Run with
// `deno task load group <tier>`; docs/capacity.md, "One large group", holds the numbers.
import http from "k6/http"
import { check } from "k6"
import { Trend } from "k6/metrics"
import {
  BASE_URL,
  compactSummary,
  deleteUsers,
  markPhase,
  pageHeaders,
  post,
  runPrefix,
  signUpUsers,
  uuidV7,
} from "./lib.js"
import { fullRead, joinGroup, searchHeaders } from "./group-lib.js"

const GROUP_ID = __ENV.GROUP_ID
const SEARCHES = JSON.parse(__ENV.SEARCHES ?? `{}`)
if (!GROUP_ID || Object.keys(SEARCHES).length === 0) {
  throw new Error(`GROUP_ID and SEARCHES are required; run deno task load group <tier>`)
}
const ITERATIONS = 5

const fullReadMs = new Trend(`group_full_read_ms`, true)
const fullReadBytes = new Trend(`group_full_read_bytes`)
const fullReadPages = new Trend(`group_full_read_pages`)
const pageMs = new Trend(`group_page_ms`, true)
const searchMs = Object.fromEntries(
  Object.keys(SEARCHES).map((name) => [name, new Trend(`group_search_${name}_ms`, true)]),
)
const writeMs = new Trend(`group_write_ms`, true)
const pullMs = new Trend(`group_pull_after_write_ms`, true)
const membersMs = new Trend(`group_members_ms`, true)

export const options = {
  setupTimeout: `2m`,
  teardownTimeout: `2m`,
  summaryTrendStats: [`avg`, `min`, `med`, `max`, `p(95)`, `count`],
  scenarios: {
    group: { executor: `per-vu-iterations`, vus: 1, iterations: ITERATIONS, maxDuration: `30m` },
  },
  thresholds: {
    "http_req_duration{scenario:group}": [`p(95)<100000`],
    "http_req_failed{scenario:group}": [`rate<0.01`],
    "http_reqs{scenario:group}": [`count>0`],
  },
}

export function setup() {
  const [user] = signUpUsers(1, `group-${runPrefix()}`)
  joinGroup(user, GROUP_ID)
  markPhase(`measure`)
  return { user }
}

export default function ({ user }) {
  const headers = pageHeaders(user.cookie)
  const read = fullRead(user, GROUP_ID)
  fullReadMs.add(read.ms)
  fullReadBytes.add(read.bytes)
  fullReadPages.add(read.pages)

  const page = http.get(`${BASE_URL}/api/groups/${GROUP_ID}/notes?limit=100`, { headers })
  check(page, { "page is 200": (r) => r.status === 200 })
  pageMs.add(page.timings.duration)

  for (const [name, q] of Object.entries(SEARCHES)) {
    const found = http.post(`${BASE_URL}/api/call/note.search`, JSON.stringify({ q }), {
      headers: searchHeaders(user),
    })
    check(found, { "search is 200": (r) => r.status === 200 })
    searchMs[name].add(found.timings.duration)
  }

  const written = post(
    `/api/groups/${GROUP_ID}/notes`,
    { id: uuidV7(), title: `Load write`, body: `Written while the group is large.` },
    user.cookie,
  )
  check(written, { "write is 201": (r) => r.status === 201 })
  writeMs.add(written.timings.duration)

  const pulled = http.get(
    `${BASE_URL}/api/groups/${GROUP_ID}/changes?after=${read.through}`,
    { headers },
  )
  check(pulled, {
    "pull is 200": (r) => r.status === 200,
    "pull has the write": (r) => r.status === 200 && r.json(`upserts.notes`).length >= 1,
  })
  pullMs.add(pulled.timings.duration)

  const members = http.get(`${BASE_URL}/api/groups/${GROUP_ID}/members`, { headers })
  check(members, { "members is 200": (r) => r.status === 200 })
  membersMs.add(members.timings.duration)
}

export function teardown({ user }) {
  markPhase(`teardown`)
  deleteUsers([user])
}

export function handleSummary(data) {
  return compactSummary(data, `group`, [
    `group_full_read_ms`,
    `group_full_read_bytes`,
    `group_full_read_pages`,
    `group_page_ms`,
    ...Object.keys(SEARCHES).map((name) => `group_search_${name}_ms`),
    `group_write_ms`,
    `group_pull_after_write_ms`,
    `group_members_ms`,
  ])
}
