import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsFindMyQueryHandler } from './queryHandlers';
import {
  NotificationCreateCommandHandler,
  NotificationSendPushCommandHandler,
  NotificationsMarkAsReadCommandHandler,
} from './commandHandlers';
import { NotificationCreatedEventHandler } from './eventHandlers/notificationCreated.eventHandler';
import { NotificationsService } from './notifications.service';

const queryHandlers = [NotificationsFindMyQueryHandler];
const commandHandlers = [
  NotificationCreateCommandHandler,
  NotificationsMarkAsReadCommandHandler,
  NotificationSendPushCommandHandler,
];
const eventHandlers = [NotificationCreatedEventHandler];

@Module({
  controllers: [NotificationsController],
  providers: [...queryHandlers, ...commandHandlers, ...eventHandlers, NotificationsService],
})
export class NotificationsModule {}
