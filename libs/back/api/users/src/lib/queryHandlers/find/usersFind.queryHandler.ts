import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { ListHandler, LogService, PaginationResponseDTO, PrismaService, UsersFindQuery } from '@seed/back/api/shared';
import { Prisma, User, UserRole } from '@prisma/client';
import { ONE } from '@seed/shared/constants';

@QueryHandler(UsersFindQuery)
export class UsersFindQueryHandler extends ListHandler implements IQueryHandler<UsersFindQuery> {
  readonly logger = new LogService(UsersFindQueryHandler.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async execute(query: UsersFindQuery): Promise<PaginationResponseDTO<User>> {
    return this.logger.trackSegment(this.execute.name, async logSegment => {
      const { search, role } = query;
      const { page, limit } = this.getPaginationData(query);

      const where = this.getFilter(search, role);

      logSegment.log('Searching for users with filter:', where);
      const findPromise = this.prisma.user.findMany({
        where: this.hasCondition(query) ? where : undefined,
        take: limit,
        skip: limit * (page - ONE),
      });
      const totalPromise = this.prisma.user.count(this.hasCondition(query) ? { where } : undefined);
      const [users, total] = await this.prisma.$transaction([findPromise, totalPromise]);
      logSegment.log('Found users:', {
        amount: users.length,
        total,
      });
      return new PaginationResponseDTO<User>(users, page, limit, total);
    });
  }

  private hasCondition(query: UsersFindQuery): boolean {
    return !!query.search || !!query.role;
  }

  private getFilter(search?: string, role?: UserRole): Prisma.UserWhereInput {
    const usernameSplit = search?.split(' ');
    const conditions =
      usernameSplit?.reduce((acc, _usernamePart) => {
        acc.push({
          userName: {
            contains: _usernamePart,
            mode: 'insensitive',
          },
        });
        acc.push({
          firstName: {
            contains: _usernamePart,
            mode: 'insensitive',
          },
        });
        acc.push({
          lastName: {
            contains: _usernamePart,
            mode: 'insensitive',
          },
        });

        return acc;
      }, new Array<Prisma.UserWhereInput>()) || [];
    return {
      AND: [
        {
          OR: [...conditions],
        },
        {
          role,
        },
      ],
    };
  }
}
