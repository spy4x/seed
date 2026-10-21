// 1,000 idle WebSockets with occasional pushes: 50 people keep 20 tabs open each, every socket
// idles for about two minutes, and once a second one of those people creates and deletes a note,
// so each change reaches that person's 20 sockets as a hint. Run with `deno task load sockets`.
import http from "k6/http"
import { check, sleep } from "k6"
import { Counter, Rate } from "k6/metrics"
import { WebSocket } from "k6/websockets"
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

/** 1,000 sockets over 50 people is 20 each: the most `@spy4x/realtime` lets one user hold. */
const USERS = 50
const SOCKETS = 1000
/** Sockets open over this many seconds, then each stays open until {@link HOLD_S} has passed. */
const RAMP_S = 30
const HOLD_S = 150

/** Whether a socket reached `open`; the error rate of the socket scenario. */
const socketOpened = new Rate(`socket_opened`)
/** Sockets the server closed, or that failed, before the run closed them. */
const socketDropped = new Counter(`socket_dropped`)
/** Frames the server sent besides its liveness pings: the pushes the sockets heard. */
const serverFrames = new Counter(`server_frames`)

export const options = {
  setupTimeout: `5m`,
  teardownTimeout: `2m`,
  scenarios: {
    sockets: {
      executor: `per-vu-iterations`,
      exec: `holdSocket`,
      vus: SOCKETS,
      iterations: 1,
      maxDuration: `${HOLD_S + 60}s`,
    },
    pushes: {
      executor: `constant-arrival-rate`,
      exec: `push`,
      rate: 1,
      timeUnit: `1s`,
      startTime: `${RAMP_S}s`,
      duration: `${HOLD_S - RAMP_S - 10}s`,
      preAllocatedVUs: 5,
    },
  },
  thresholds: {
    socket_opened: [`rate>0.99`],
    socket_dropped: [`count<1`],
    ws_connecting: [`p(95)<1000`],
    "http_req_duration{scenario:pushes}": [`p(95)<1000`],
    "http_req_failed{scenario:pushes}": [`rate<0.01`],
    "http_reqs{scenario:pushes}": [`count>0`],
  },
}

export function setup() {
  const users = signUpUsers(USERS, `sockets-${runPrefix()}`)
  markPhase(`measure`)
  return { users }
}

/** One socket of one person, opened within {@link RAMP_S} and held until {@link HOLD_S}. */
export function holdSocket({ users }) {
  const user = users[(__VU - 1) % users.length]
  const wait = Math.random() * RAMP_S
  sleep(wait)
  const url = `${BASE_URL.replace(/^http/, `ws`)}/api/ws`
  const socket = new WebSocket(url, [`user.${user.userId}`], {
    headers: { cookie: user.cookie, origin: pageHeaders().origin },
  })
  let opened = false
  let closing = false
  socket.onopen = () => {
    opened = true
    socketOpened.add(true)
    setTimeout(() => {
      closing = true
      socket.close()
    }, (HOLD_S - wait) * 1000)
  }
  // The server closes a socket that says nothing for 90 seconds, so answer its pings as the
  // app's client does (`@spy4x/realtime`).
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.kind === `server.ping`) {
      socket.send(
        JSON.stringify({ kind: `client.pong`, ...(message.id ? { id: message.id } : {}) }),
      )
    } else serverFrames.add(1)
  }
  socket.onerror = () => {
    if (!opened) socketOpened.add(false)
  }
  socket.onclose = () => {
    if (opened && !closing) socketDropped.add(1)
  }
}

/** One push: a person creates a note and deletes it, two changes their sockets hear about. */
export function push({ users }) {
  const user = users[Math.floor(Math.random() * users.length)]
  const created = createNote(user, `Pushed`)
  if (!check(created, { "create is 201": (r) => r.status === 201 })) return
  const note = created.json(`note`)
  const deleted = http.del(
    `${BASE_URL}/api/groups/${user.groupId}/notes/${note.id}`,
    JSON.stringify({ version: note.version }),
    { headers: pageHeaders(user.cookie) },
  )
  check(deleted, { "delete is 200": (r) => r.status === 200 })
}

export function teardown({ users }) {
  markPhase(`teardown`)
  deleteUsers(users)
}

export function handleSummary(data) {
  return compactSummary(data, `pushes`, [
    `socket_opened`,
    `socket_dropped`,
    `server_frames`,
    `ws_connecting`,
    `ws_msgs_received`,
    `ws_sessions`,
  ])
}
