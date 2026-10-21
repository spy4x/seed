// 50 signed-in people writing at once: each creates a note, edits it, and deletes it again, with a
// second or two of typing between steps. Deleting keeps every group under the Free plan's cap of
// 10 notes, so the run measures writes and never the cap's 402. Run with `deno task load write`.
import http from "k6/http"
import { check, sleep } from "k6"
import {
  BASE_URL,
  compactSummary,
  createNote,
  deleteUsers,
  markPhase,
  pageHeaders,
  runPrefix,
  signUpUsers,
} from "./lib.js"

const USERS = 50

export const options = {
  setupTimeout: `5m`,
  teardownTimeout: `2m`,
  scenarios: {
    write: {
      executor: `ramping-vus`,
      stages: [
        { duration: `30s`, target: USERS },
        { duration: `2m`, target: USERS },
        { duration: `10s`, target: 0 },
      ],
    },
  },
  thresholds: {
    "http_req_duration{scenario:write}": [`p(95)<1000`],
    "http_req_failed{scenario:write}": [`rate<0.01`],
    "http_reqs{scenario:write}": [`count>0`],
  },
}

export function setup() {
  const users = signUpUsers(USERS, `write-${runPrefix()}`)
  markPhase(`measure`)
  return { users }
}

export default function ({ users }) {
  const user = users[(__VU - 1) % users.length]
  const headers = pageHeaders(user.cookie)
  const created = createNote(user, `Draft`)
  if (!check(created, { "create is 201": (r) => r.status === 201 })) return sleep(1)
  const note = created.json(`note`)
  const url = `${BASE_URL}/api/groups/${user.groupId}/notes/${note.id}`
  sleep(0.5 + Math.random())
  const body = {
    title: `Edited`,
    body: `Edited by the load test. `.repeat(12),
    version: note.version,
  }
  const updated = http.patch(url, JSON.stringify(body), { headers })
  if (!check(updated, { "update is 200": (r) => r.status === 200 })) return sleep(1)
  sleep(0.5 + Math.random())
  const version = updated.json(`note.version`)
  const deleted = http.del(url, JSON.stringify({ version }), { headers })
  check(deleted, { "delete is 200": (r) => r.status === 200 })
  sleep(0.5 + Math.random())
}

export function teardown({ users }) {
  markPhase(`teardown`)
  deleteUsers(users)
}

export function handleSummary(data) {
  return compactSummary(data, `write`)
}
