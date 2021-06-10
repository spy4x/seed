import { CommandHandler } from '@nestjs/cqrs';
import {
  BaseCommandHandler,
  NotificationsMarkAsReadCommand,
  NotificationsMarkAsReadDTO,
  PrismaService,
} from '@seed/back/api/shared';
import { Prisma } from '@prisma/client';

@CommandHandler(NotificationsMarkAsReadCommand)
export class NotificationsMarkAsReadCommandHandler extends BaseCommandHandler<NotificationsMarkAsReadCommand> {
  constructor(readonly prisma: PrismaService) {
    super();
  }

  async execute(command: NotificationsMarkAsReadCommand): Promise<NotificationsMarkAsReadDTO> {
    const where: Prisma.NotificationWhereInput = {
      userId: command.currentUserId,
      isRead: false,
    };
    if (command.ids && command.ids.length) {
      where.id = {
        in: command.ids,
      };
    }
    return this.prisma.notification.updateMany({
      where,
      data: {
        isRead: true,
      },
    });
  }
}
