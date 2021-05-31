import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { UserGetQuery, PrismaService, UserDTO } from '@seed/back/api/shared';

@QueryHandler(UserGetQuery)
export class UserGetQueryHandler implements IQueryHandler<UserGetQuery> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(query: UserGetQuery): Promise<UserDTO | null> {
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
