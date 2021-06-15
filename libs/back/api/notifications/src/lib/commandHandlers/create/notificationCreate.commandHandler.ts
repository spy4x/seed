import { CommandHandler } from '@nestjs/cqrs';
import {
  BaseCommandHandler,
  PrismaService,
  NotificationCreateCommand,
  EventBusExt,
  NotificationCreatedEvent,
  LogService,
} from '@seed/back/api/shared';
import { Notification } from '@prisma/client';

@CommandHandler(NotificationCreateCommand)
export class NotificationCreateCommandHandler extends BaseCommandHandler<NotificationCreateCommand> {
  readonly logger = new LogService(NotificationCreateCommandHandler.name);

  constructor(readonly prisma: PrismaService, readonly eventBus: EventBusExt) {
    super();
  }

  async execute(command: NotificationCreateCommand): Promise<Notification> {
    return this.logger.trackSegment(this.execute.name, async logSegment => {
      logSegment.log(`Saving notification to DB...`);
      const notification = await this.prisma.notification.create({
        data: command,
      });
      logSegment.log(`Saved`, notification);
      this.eventBus.publish(new NotificationCreatedEvent(notification));
      logSegment.log(`Published NotificationCreatedEvent`);
      return notification;
    });
  }
}
