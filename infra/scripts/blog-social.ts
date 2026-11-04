/// <reference lib="deno.ns" />
/**
 * Prints the LinkedIn, Telegram and X texts of one of Seed's own posts (#733), for the owner to
 * paste once the post is live: `deno task blog:social <slug>`. The words come from the post's file
 * (`libs/server/blog/seed-posts/<slug>.md`); `socialTexts` says how each text is built.
 *
 * @module
 */
import { denoFileSystem } from "@spy4x/platform/server/deno-fs"
import { readSeedPosts } from "../../libs/server/blog/seed-posts.ts"
import { socialTexts } from "../../libs/server/blog/social-texts.ts"

/** The website Seed's own posts live on. */
const ORIGIN = `https://seedsaas.com`

const slug = Deno.args[0]
if (!slug) {
  console.error(`Usage: deno task blog:social <slug>`)
  Deno.exit(2)
}
const post = (await readSeedPosts(denoFileSystem)).find(({ fields }) => fields.slug === slug)
if (!post) {
  console.error(`No post file has the slug ${slug}.`)
  Deno.exit(1)
}
const texts = socialTexts(post.fields, ORIGIN)
for (const [channel, text] of [[`LinkedIn`, texts.linkedin], [`Telegram`, texts.telegram], [
  `X`,
  texts.x,
]]) {
  console.log(`--- ${channel} ---\n${text}\n`)
}
