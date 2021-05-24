import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { GetUserQuery, PrismaService, UserDetailsDto } from '@seed/back/api/shared';

@QueryHandler(GetUserQuery)
export class GetUserHandler implements IQueryHandler<GetUserQuery> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(query: GetUserQuery): Promise<UserDetailsDto | null> {
    const user = await this.prisma.user.findUnique({
      select: {
        id: true,
        userName: true,
        firstName: true,
        lastName: true,
        photoURL: true,
      },
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
