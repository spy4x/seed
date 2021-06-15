import { Notification } from '@prisma/client';

export class NotificationSendPushCommand {
  constructor(
    public notification: Notification,
    public title: string,
    public body: string,
    public fcmTokens: string[],
  ) {}
}
