import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { IsUsernameFreeQuery, PrismaService } from '@seed/back/api/shared';

@QueryHandler(IsUsernameFreeQuery)
export class IsUsernameFreeHandler implements IQueryHandler<IsUsernameFreeQuery> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(query: IsUsernameFreeQuery): Promise<boolean> {
    const u = await this.prisma.user.findUnique({
      where: {
        userName: query.userName,
      },
      select: {
        id: true,
      },
    });

    return !u;
  }
}
