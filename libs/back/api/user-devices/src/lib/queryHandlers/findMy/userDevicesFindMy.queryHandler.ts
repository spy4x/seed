import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import {
  ListHandler,
  PaginationResponseDTO,
  PrismaService,
  UserDeviceDTO,
  UserDevicesFindMyQuery,
} from '@seed/back/api/shared';
import { Prisma } from '@prisma/client';

@QueryHandler(UserDevicesFindMyQuery)
export class UserDevicesFindMyQueryHandler extends ListHandler implements IQueryHandler<UserDevicesFindMyQuery> {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async execute(query: UserDevicesFindMyQuery): Promise<PaginationResponseDTO<UserDeviceDTO>> {
    const { currentUserId } = query;
    const { page, limit } = this.getPaginationData(query);
    const where: Prisma.UserDeviceWhereInput = {
      userId: currentUserId,
    };
    const findPromise = this.prisma.userDevice.findMany({
      where,
      ...this.getPrismaTakeAndSkip(query),
    });

    const totalPromise = this.prisma.userDevice.count({ where });
    const [data, total] = await this.prisma.$transaction([findPromise, totalPromise]);
    return new PaginationResponseDTO<UserDeviceDTO>(data, page, limit, total);
  }
}
