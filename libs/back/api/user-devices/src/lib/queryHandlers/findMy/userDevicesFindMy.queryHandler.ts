import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import {
  ListHandler,
  LogService,
  PaginationResponseDTO,
  PrismaService,
  UserDevicesFindMyQuery,
} from '@seed/back/api/shared';
import { Prisma, UserDevice } from '@prisma/client';

@QueryHandler(UserDevicesFindMyQuery)
export class UserDevicesFindMyQueryHandler extends ListHandler implements IQueryHandler<UserDevicesFindMyQuery> {
  readonly logger = new LogService(UserDevicesFindMyQueryHandler.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async execute(query: UserDevicesFindMyQuery): Promise<PaginationResponseDTO<UserDevice>> {
    return this.logger.trackSegment(this.execute.name, async logSegment => {
      const { currentUserId } = query;
      const { page, limit } = this.getPaginationData(query);
      const where: Prisma.UserDeviceWhereInput = {
        userId: currentUserId,
      };
      logSegment.log('Searching for userDevices with filter:', where);
      const findPromise = this.prisma.userDevice.findMany({
        where,
        ...this.getPrismaTakeAndSkip(query),
      });

      const totalPromise = this.prisma.userDevice.count({ where });
      const [data, total] = await this.prisma.$transaction([findPromise, totalPromise]);
      logSegment.log('Found userDevices:', {
        amount: data.length,
        total,
      });
      return new PaginationResponseDTO<UserDevice>(data, page, limit, total);
    });
  }
}
