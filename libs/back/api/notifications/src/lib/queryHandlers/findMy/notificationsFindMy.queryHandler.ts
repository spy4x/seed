import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { ListHandler, PaginationResponseDTO, PrismaService, NotificationsFindMyQuery } from '@seed/back/api/shared';
import { Prisma, Notification } from '@prisma/client';

@QueryHandler(NotificationsFindMyQuery)
export class NotificationsFindMyQueryHandler extends ListHandler implements IQueryHandler<NotificationsFindMyQuery> {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async execute(query: NotificationsFindMyQuery): Promise<PaginationResponseDTO<Notification>> {
    const { currentUserId } = query;
    const { page, limit } = this.getPaginationData(query);
    const where: Prisma.NotificationWhereInput = {
      userId: currentUserId,
    };
    const findPromise = this.prisma.notification.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
      ...this.getPrismaTakeAndSkip(query),
    });

    const totalPromise = this.prisma.notification.count({ where });
    const [data, total] = await this.prisma.$transaction([findPromise, totalPromise]);
    return new PaginationResponseDTO<Notification>(data, page, limit, total);
  }
}
