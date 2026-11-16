/// <reference lib="deno.ns" />
/**
 * Generates VAPID keys for Web Push and writes them to infra/configs/vapid.json,
 * which compose bind-mounts into the API container as /app/vapid.json. A path given as the first
 * argument is written instead; run the script directly then, with `-W=<that path>`.
 *
 * Uses the same `@spy4x/integrations/push` version the API imports, so the file is always in the
 * format the API reads: `{ "publicKey": <JWK>, "privateKey": <JWK> }`. Nothing is fetched from a
 * moving branch.
 */
import { generateVapidKeyPair } from "@spy4x/integrations/push"

const OUTPUT_PATH = Deno.args[0] ?? "infra/configs/vapid.json"

const { keys } = await generateVapidKeyPair()

await Deno.writeTextFile(OUTPUT_PATH, JSON.stringify(keys))
console.log(`VAPID keys written to ${OUTPUT_PATH}`)
