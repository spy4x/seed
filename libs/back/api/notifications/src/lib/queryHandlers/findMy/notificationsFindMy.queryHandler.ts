import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import {
  ListHandler,
  PaginationResponseDTO,
  PrismaService,
  NotificationsFindMyQuery,
  LogService,
} from '@seed/back/api/shared';
import { Prisma, Notification } from '@prisma/client';

@QueryHandler(NotificationsFindMyQuery)
export class NotificationsFindMyQueryHandler extends ListHandler implements IQueryHandler<NotificationsFindMyQuery> {
  readonly logger = new LogService(NotificationsFindMyQueryHandler.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async execute(query: NotificationsFindMyQuery): Promise<PaginationResponseDTO<Notification>> {
    return this.logger.trackSegment(this.execute.name, async logSegment => {
      const { currentUserId } = query;
      const { page, limit } = this.getPaginationData(query);
      const where: Prisma.NotificationWhereInput = {
        userId: currentUserId,
      };
      logSegment.log(`Fetching notifications for user...`);
      const findPromise = this.prisma.notification.findMany({
        where,
        orderBy: {
          createdAt: 'desc',
        },
        ...this.getPrismaTakeAndSkip(query),
      });

      const totalPromise = this.prisma.notification.count({ where });
      const [data, total] = await this.prisma.$transaction([findPromise, totalPromise]);
      logSegment.log(`Notifications fetched:`, {
        amount: data.length,
        total,
      });
      return new PaginationResponseDTO<Notification>(data, page, limit, total);
    });
  }
}
