import { ICommand } from '@nestjs/cqrs';
import { NotificationEvent } from '../../baseClasses';

export class NotificationSendCommand implements ICommand {
  notificationData: NotificationEvent;

  constructor(data: NotificationEvent) {
    this.notificationData = data;
  }
}
