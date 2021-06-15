import { Notification } from '@prisma/client';

export class NotificationCreatedEvent {
  constructor(public notification: Notification) {}
}
