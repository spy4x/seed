import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { UserIsUsernameFreeQuery, PrismaService } from '@seed/back/api/shared';

@QueryHandler(UserIsUsernameFreeQuery)
export class UserIsUsernameFreeQueryHandler implements IQueryHandler<UserIsUsernameFreeQuery> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(query: UserIsUsernameFreeQuery): Promise<boolean> {
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
