import { CommandHandler } from '@nestjs/cqrs';
import {
  BaseCommandHandler,
  PrismaService,
  NotificationCreateCommand,
  EventBusExt,
  NotificationCreatedEvent,
} from '@seed/back/api/shared';
import { Notification } from '@prisma/client';

@CommandHandler(NotificationCreateCommand)
export class NotificationCreateCommandHandler extends BaseCommandHandler<NotificationCreateCommand> {
  constructor(readonly prisma: PrismaService, readonly eventBus: EventBusExt) {
    super();
  }

  async execute(command: NotificationCreateCommand): Promise<Notification> {
    const notification = await this.prisma.notification.create({
      data: command,
    });
    this.eventBus.publish(new NotificationCreatedEvent(notification));
    return notification;
  }
}
