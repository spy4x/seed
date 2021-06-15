export class NotificationSendPushInvalidTokensEvent {
  constructor(public fcmTokens: string[]) {}
}
