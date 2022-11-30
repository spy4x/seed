import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { UserIsUsernameFreeQuery, PrismaService, LogService } from '@seed/back/api/shared';

@QueryHandler(UserIsUsernameFreeQuery)
export class UserIsUsernameFreeQueryHandler implements IQueryHandler<UserIsUsernameFreeQuery> {
  readonly logger = new LogService(UserIsUsernameFreeQueryHandler.name);

  constructor(private readonly prisma: PrismaService) {}

  async execute(query: UserIsUsernameFreeQuery): Promise<boolean> {
    return this.logger.trackSegment(
      this.execute.name,
      async logSegment => {
        const user = await this.prisma.user.findFirst({
          where: {
            userName: query.userName,
          },
          select: {
            id: true,
          },
        });
        logSegment.log('User with such username:', user);
        return !user;
      },
      query,
    );
  }
}
