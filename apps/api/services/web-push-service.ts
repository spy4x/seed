import type {
  PushNotificationMessage,
  PushSubscribeRequest,
  PushSubscriptionJson,
} from "@spy4x/platform/model"
import {
  createWebPushSender,
  type PushOptions,
  type PushSendResult,
  type PushSubscriptionStore,
  type VapidKeys,
  vapidPublicKey,
  type WebPushSender,
  type WebPushSenderOptions,
} from "@spy4x/integrations/push"
import { AccessError, type UserPushTokenPublic } from "@domain/identity"
import type { PushTokenRecord, PushTokenStore } from "./push-token-store.ts"

/** The library's sender options this service passes through; it supplies keys and store. */
export type PushSenderOptions = Omit<WebPushSenderOptions, "vapidKeys" | "store">

function subscriptionOf(token: PushTokenRecord): PushSubscriptionJson {
  return {
    endpoint: token.endpoint,
    expirationTime: null,
    keys: { auth: token.auth, p256dh: token.p256dh },
  }
}

/** The library's store over the app's rows: every live subscription of a user. */
function subscriptionsOf(store: PushTokenStore): PushSubscriptionStore {
  return {
    listByUser: async (userId) => (await store.listByUser(Number(userId))).map(subscriptionOf),
    deleteByEndpoint: (userId, endpoint) => store.deleteByEndpoint(userId, endpoint),
  }
}

/** Logs what the push service reported. The endpoint is never logged: its path is a capability. */
function logResult(userId: number, result: PushSendResult): PushSendResult {
  const deleted = result.deliveries.filter((delivery) => delivery.deleted).length
  if (deleted) console.log("Subscription is no longer valid, deleted", { userId, deleted })
  if (!result.success) console.error("Error sending push notification", result.error)
  return result
}

function toPublic(token: PushTokenRecord): UserPushTokenPublic {
  const { id, userId, deviceId, createdAt, updatedAt } = token
  return { id, userId, deviceId, createdAt, updatedAt }
}

/**
 * Web Push for signed-in users. Subscriptions live in Postgres (`store`), so they survive a
 * restart, and `send` reaches only the devices of the one user it is given. Encryption, VAPID
 * signing, delivery and deleting gone subscriptions are `@spy4x/integrations/push`'s job.
 */
export class WebPushService {
  constructor(
    private readonly vapidKeys: VapidKeys,
    private readonly senderOptions: PushSenderOptions,
    private readonly store: PushTokenStore,
    private readonly encodedPublicKey: string,
    /** Sends over every subscription in `store`; built once by `createWebPushService`. */
    private readonly sender: WebPushSender,
  ) {}

  public getPublicKey(): string {
    return this.encodedPublicKey
  }

  /**
   * Stores the subscription for session `sessionId` of `userId` and sends it a welcome push.
   * Throws `AccessError` when the session has ended by the time the row would be written, as
   * after a password reset (#409).
   */
  public async subscribe(
    subscription: PushSubscribeRequest["subscription"],
    deviceId: string,
    userId: number,
    sessionId: number,
  ): Promise<UserPushTokenPublic> {
    const token = await this.store.upsertForSession({
      sessionId,
      userId,
      deviceId,
      endpoint: subscription.endpoint,
      auth: subscription.keys.auth,
      p256dh: subscription.keys.p256dh,
    })
    if (!token) throw new AccessError("AUTH_REQUIRED", "The session has ended")
    // The welcome push goes to this one subscription only, not to the user's other devices. One
    // the push service reports gone deletes the row, yet subscribe still reports success: the
    // browser handed us the subscription a moment ago.
    const welcome = await createWebPushSender({
      ...this.senderOptions,
      vapidKeys: this.vapidKeys,
      store: {
        listByUser: () => Promise.resolve([subscriptionOf(token)]),
        deleteByEndpoint: (user, endpoint) => this.store.deleteByEndpoint(user, endpoint),
      },
    })
    logResult(
      userId,
      await welcome.send(userId, {
        title: "✅ Test Push Notification",
        body: "You are now subscribed",
        url: null,
      }),
    )
    return toPublic(token)
  }

  public async deviceList(userId: number): Promise<UserPushTokenPublic[]> {
    return (await this.store.listByUser(userId)).map(toPublic)
  }

  public async unsubscribe(deviceId: string, userId: number): Promise<void> {
    await this.store.remove({ userId, deviceId })
  }

  /**
   * Pushes `message` to every device of `userId`, and to nobody else. A subscription the push
   * service reports gone (404 or 410) is deleted; any other failure is logged, and the remaining
   * devices are still tried. Never throws; an invalid payload is a failed result.
   */
  public async send(
    userId: number,
    message: PushNotificationMessage,
    options: PushOptions = {},
  ): Promise<PushSendResult> {
    return logResult(userId, await this.sender.send(userId, message, options))
  }
}

/**
 * Builds the service from the VAPID key file's text. The file is what `@negrel/webpush`'s
 * `exportVapidKeys` wrote: `{ "publicKey": <JWK>, "privateKey": <JWK> }`, the library's
 * `VapidKeys`. Throws on keys that do not import, so a broken file stops start-up.
 */
export async function createWebPushService(
  vapidKeysJson: string,
  senderOptions: PushSenderOptions,
  store: PushTokenStore,
): Promise<WebPushService> {
  const vapidKeys: VapidKeys = JSON.parse(vapidKeysJson)
  const sender = await createWebPushSender({
    ...senderOptions,
    vapidKeys,
    store: subscriptionsOf(store),
  })
  return new WebPushService(
    vapidKeys,
    senderOptions,
    store,
    await vapidPublicKey(vapidKeys),
    sender,
  )
}
