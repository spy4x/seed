import type postgres from "postgres"
import { type } from "arktype"
import {
  bulletList,
  button,
  heading,
  type Letter,
  type LetterBlock,
  paragraph,
  renderLetter,
  UNSUBSCRIBE_PLACEHOLDER,
} from "@spy4x/email/letter"
import type { MailBrand } from "../mail/mail.ts"
import { enqueueJob } from "./jobs.ts"
import { SUBSCRIBER_SEND_ISSUE_JOB } from "./subscriber-mail.ts"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

/**
 * One issue as `deno task subscribers:send` reads it from JSON. `id` names the issue in the send
 * log: running the same id again mails only the subscribers the first run missed, so never reuse
 * one for a new issue.
 */
export const subscriberIssueSchema = type({
  "+": `reject`,
  id: /^[a-z0-9][a-z0-9._-]{0,99}$/,
  subject: `1 <= string <= 200`,
  "preheader?": `string <= 200`,
  blocks: type({ "+": `reject`, heading: `1 <= string <= 200` })
    .or({ "+": `reject`, paragraph: `1 <= string <= 10000` })
    .or({ "+": `reject`, list: `(1 <= string <= 1000)[] > 0` })
    .or({
      "+": `reject`,
      button: { "+": `reject`, href: `string.url <= 2000`, label: `1 <= string <= 100` },
    })
    .array()
    .atLeastLength(1),
})
export type SubscriberIssue = typeof subscriberIssueSchema.infer

/** An issue rendered once, with the unsubscribe placeholder each recipient's link replaces. */
export interface RenderedIssue {
  id: string
  subject: string
  letter: Letter
}

/** Renders `issue` with the app's footer and the placeholder `sendIssue` fills per recipient. */
export function renderSubscriberIssue(brand: MailBrand, issue: SubscriberIssue): RenderedIssue {
  const host = new URL(brand.webAppUrl).host
  const blocks = issue.blocks.map((block): LetterBlock => {
    if (`heading` in block) return heading(block.heading)
    if (`paragraph` in block) return paragraph(block.paragraph)
    if (`list` in block) return bulletList(block.list)
    return button(block.button.href, block.button.label)
  })
  const letter = renderLetter({
    blocks,
    footer: {
      reason: `You get this mail because you subscribed at ${host}.`,
      unsubscribeLink: UNSUBSCRIBE_PLACEHOLDER,
    },
    ...(issue.preheader ? { preheader: issue.preheader } : {}),
  })
  return { id: issue.id, subject: issue.subject, letter }
}

/**
 * Stores the rendered issue for `list` and queues its send. The same id again replaces the stored
 * content and queues another run, which mails only whom the earlier runs did not reach.
 */
export async function queueSubscriberIssue(
  sql: postgres.Sql,
  list: string,
  issue: RenderedIssue,
): Promise<void> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO subscriber_issue_content (id, list_id, issue_id, subject, html, text)
    VALUES (
      ${uuidV7()}, ${list}, ${issue.id}, ${issue.subject}, ${issue.letter.html},
      ${issue.letter.text}
    )
    ON CONFLICT (list_id, issue_id) DO UPDATE
      SET subject = EXCLUDED.subject, html = EXCLUDED.html, text = EXCLUDED.text
    RETURNING id
  `
  await enqueueJob(sql, SUBSCRIBER_SEND_ISSUE_JOB, row.id, { inMs: 0 })
}
