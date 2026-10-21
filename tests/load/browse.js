// 100 signed-in people reading notes at once: each lists its group's notes, opens one, and reads
// for one to three seconds before the next page. Run with `deno task load browse`.
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

const USERS = 100
/** Notes each person has to browse; under the Free plan's cap of 10. */
const NOTES_EACH = 8

export const options = {
  setupTimeout: `5m`,
  teardownTimeout: `2m`,
  scenarios: {
    browse: {
      executor: `ramping-vus`,
      stages: [
        { duration: `30s`, target: USERS },
        { duration: `2m`, target: USERS },
        { duration: `10s`, target: 0 },
      ],
    },
  },
  thresholds: {
    "http_req_duration{scenario:browse}": [`p(95)<1000`],
    "http_req_failed{scenario:browse}": [`rate<0.01`],
    "http_reqs{scenario:browse}": [`count>0`],
  },
}

export function setup() {
  const users = signUpUsers(USERS, `browse-${runPrefix()}`)
  for (const user of users) {
    for (let i = 0; i < NOTES_EACH; i++) createNote(user, `Note ${i + 1}`)
  }
  markPhase(`measure`)
  return { users }
}

export default function ({ users }) {
  const user = users[(__VU - 1) % users.length]
  const headers = pageHeaders(user.cookie)
  const list = http.get(`${BASE_URL}/api/groups/${user.groupId}/notes?limit=20`, { headers })
  check(list, { "list is 200": (r) => r.status === 200 })
  const notes = list.status === 200 ? list.json(`notes`) ?? [] : []
  if (notes.length > 0) {
    const note = notes[Math.floor(Math.random() * notes.length)]
    const one = http.get(`${BASE_URL}/api/groups/${user.groupId}/notes/${note.id}`, { headers })
    check(one, { "note is 200": (r) => r.status === 200 })
  }
  sleep(1 + Math.random() * 2)
}

export function teardown({ users }) {
  markPhase(`teardown`)
  deleteUsers(users)
}

export function handleSummary(data) {
  return compactSummary(data, `browse`)
}
