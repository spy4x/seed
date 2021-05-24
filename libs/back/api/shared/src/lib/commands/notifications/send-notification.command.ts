import { ICommand } from '@nestjs/cqrs';
import { NotifierEvent } from '../../interfaces';

export class SendNotificationCommand implements ICommand {
  notificationData: NotifierEvent;

  constructor(data: NotifierEvent) {
    this.notificationData = data;
  }
}
