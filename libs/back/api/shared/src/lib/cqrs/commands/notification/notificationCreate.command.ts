import { NotificationType } from '@prisma/client';

export class NotificationCreateCommand {
  constructor(public userId: string, public type: NotificationType) {}
}
