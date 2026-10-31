// Helpers of the large-group scenarios (`group.js`, `group-reads.js`).
import http from "k6/http"
import { BASE_URL, pageHeaders, post } from "./lib.js"

/**
 * Makes `user` an editor of the load group through the development-only route, as a person given
 * the group would be. Throws when it cannot, so a run never measures a group it cannot read.
 */
export function joinGroup(user, groupId) {
  const added = post(`/api/test/add-member`, { login: user.email, groupId, role: 2 })
  if (added.status !== 200) {
    throw new Error(`add-member: ${added.status} ${added.body}; build the group first`)
  }
}

/** The headers of `POST /api/call/<name>` for `user`. */
export function searchHeaders(user) {
  return { ...pageHeaders(user.cookie), "x-realtime-user": String(user.userId) }
}

/**
 * Reads the whole group the way the SPA fills its device copy (`docs/offline.md`): the changes
 * pull from cursor 0, one page after the other, until a page says there is no more. Answers the
 * time from the first request to the last answer, the bytes of every body, the page count and the
 * cursor the read ended at. Throws on a failed page, so a run never counts half a read.
 */
export function fullRead(user, groupId) {
  const headers = pageHeaders(user.cookie)
  const started = Date.now()
  let after = 0
  let bytes = 0
  let pages = 0
  for (;;) {
    const page = http.get(`${BASE_URL}/api/groups/${groupId}/changes?after=${after}`, {
      headers,
      tags: { name: `changes` },
    })
    if (page.status !== 200) throw new Error(`changes after ${after}: ${page.status}`)
    const body = page.json()
    if (body.status !== `changes`) throw new Error(`changes after ${after}: ${body.status}`)
    bytes += page.body.length
    pages += 1
    after = body.through
    if (!body.more) break
  }
  return { ms: Date.now() - started, bytes, pages, through: after }
}
