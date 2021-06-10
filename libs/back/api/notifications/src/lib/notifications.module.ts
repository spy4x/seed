import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsFindMyQueryHandler } from './queryHandlers';
import { NotificationCreateCommandHandler, NotificationsMarkAsReadCommandHandler } from './commandHandlers';

const queryHandlers = [NotificationsFindMyQueryHandler];
const commandHandlers = [NotificationCreateCommandHandler, NotificationsMarkAsReadCommandHandler];

@Module({
  controllers: [NotificationsController],
  providers: [...queryHandlers, ...commandHandlers],
})
export class NotificationsModule {}
