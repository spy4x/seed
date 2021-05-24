import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { CurrentUserDetailsDto, GetCurrentUserQuery, PrismaService } from '@seed/back/api/shared';

@QueryHandler(GetCurrentUserQuery)
export class GetCurrentUserHandler implements IQueryHandler<GetCurrentUserQuery> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(query: GetCurrentUserQuery): Promise<CurrentUserDetailsDto | null> {
    const user = await this.prisma.user.findUnique({
      where: {
        id: query.id,
      },
    });
    if (!user) {
      return null;
    }
    return user;
  }
}
