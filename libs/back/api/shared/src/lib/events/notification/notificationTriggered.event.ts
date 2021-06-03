import { NotificationType } from '@prisma/client';
import { NotificationEvent } from '../../baseClasses';

export class NotificationTriggeredEvent extends NotificationEvent {
  constructor(public type: NotificationType, receivers: { id: string }[]) {
    super(null, type, undefined, new Date(), receivers);
  }

  getData(): { [key: string]: string } {
    return {};
  }

  getNotification(): { title: string; body: string } {
    let title = '';
    let body = '';

    switch (this.type) {
      case NotificationType.WELCOME:
        title = `Have you worked out today?`;
        body = `If you have, post the workout to track your progress 💪`;
        break;
      default:
        throw new Error("Notification type doesn't exist");
    }
    return {
      title,
      body,
    };
  }
}
