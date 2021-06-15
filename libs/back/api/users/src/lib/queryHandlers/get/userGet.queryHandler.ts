import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { User } from '@prisma/client';
import { LogService, PrismaService, UserGetQuery } from '@seed/back/api/shared';

@QueryHandler(UserGetQuery)
export class UserGetQueryHandler implements IQueryHandler<UserGetQuery> {
  readonly logger = new LogService(UserGetQueryHandler.name);

  constructor(private readonly prisma: PrismaService) {}

  async execute(query: UserGetQuery): Promise<User | null> {
    return this.logger.trackSegment(this.execute.name, async logSegment => {
      const user = await this.prisma.user.findUnique({
        where: {
          id: query.id,
        },
      });
      logSegment.log('Fetched user:', user);
      return user;
    });
  }
}
