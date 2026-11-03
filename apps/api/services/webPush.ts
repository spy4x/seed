import { runtimeFileSystem } from "@spy4x/platform/server/runtime-fs"
import { config } from "./config.ts"
import { createPushTokenStore } from "./push-token-store.ts"
import { sql } from "./db.ts"
import { createWebPushService, type WebPushService } from "./web-push-service.ts"

let service: Promise<WebPushService> | undefined

/**
 * The API's one Web Push service, built on first use from the VAPID keys file. `index.ts` awaits it
 * at start-up so a missing file stops the API there, and the push handlers share the instance.
 */
export function getWebPush(): Promise<WebPushService> {
  service ??= (async () => {
    const keys = await runtimeFileSystem.readText(config.vapidKeysPath)
    if (keys === null) throw new Error(`The VAPID keys file is missing: ${config.vapidKeysPath}`)
    return await createWebPushService(
      keys,
      { subject: `mailto:${config.devEmail}` },
      createPushTokenStore(sql),
    )
  })()
  return service
}
