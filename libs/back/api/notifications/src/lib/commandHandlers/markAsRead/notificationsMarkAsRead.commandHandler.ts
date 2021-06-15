import { CommandHandler } from '@nestjs/cqrs';
import {
  BaseCommandHandler,
  LogService,
  NotificationsMarkAsReadCommand,
  NotificationsMarkAsReadDTO,
  PrismaService,
} from '@seed/back/api/shared';
import { Prisma } from '@prisma/client';

@CommandHandler(NotificationsMarkAsReadCommand)
export class NotificationsMarkAsReadCommandHandler extends BaseCommandHandler<NotificationsMarkAsReadCommand> {
  readonly logger = new LogService(NotificationsMarkAsReadCommandHandler.name);

  constructor(readonly prisma: PrismaService) {
    super();
  }

  async execute(command: NotificationsMarkAsReadCommand): Promise<NotificationsMarkAsReadDTO> {
    return this.logger.trackSegment(this.execute.name, async logSegment => {
      const shouldMarkAllNotifications = command.ids && command.ids.length;
      logSegment.log(
        `Marking user's (id: ${command.currentUserId}) notifications ${
          shouldMarkAllNotifications ? '(all)' : `(ids: ${command.ids?.join(', ')})`
        } as read...`,
      );
      const where: Prisma.NotificationWhereInput = {
        userId: command.currentUserId,
        isRead: false,
      };
      if (shouldMarkAllNotifications) {
        where.id = {
          in: command.ids,
        };
      }
      const result = await this.prisma.notification.updateMany({
        where,
        data: {
          isRead: true,
        },
      });
      logSegment.log(`Updated ${result.count} notifications`);
      return result;
    });
  }
}
