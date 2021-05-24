import { NotificationType } from '.prisma/client';
import { NotifierEvent } from '../../interfaces';

export class TriggeredNotificationEvent extends NotifierEvent {
  constructor(public type: NotificationType, receivers: { id: string }[]) {
    super(null, type, undefined, new Date(), receivers);
  }

  getData(): { [key: string]: string } {
    return {};
  }

  getNotification(): { title: string; body: string } {
    let title = '';
    let body = '';

    // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check
    switch (this.type) {
      case NotificationType.WELCOME:
        title = `Have you worked out today?`;
        body = `If you have, post the workout on Corecircle to track your progress 💪`;
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
