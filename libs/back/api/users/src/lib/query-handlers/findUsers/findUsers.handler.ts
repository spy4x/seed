import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { FindUsersQuery, ListHandler, Pagination, PrismaService, UserDto } from '@seed/back/api/shared';

@QueryHandler(FindUsersQuery)
export class FindUsersHandler extends ListHandler implements IQueryHandler<FindUsersQuery> {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async execute(query: FindUsersQuery): Promise<Pagination<UserDto>> {
    const { search } = query;
    const { page, limit } = this.getPaginationData(query);
    const usernameSplit = search?.split(' ');

    const conditions =
      usernameSplit?.map(_usernamePart => ({
        userName: {
          contains: _usernamePart,
        },
        firstName: {
          contains: _usernamePart,
        },
        lastName: {
          contains: _usernamePart,
        },
      })) || [];
    // eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-explicit-any
    const where: { OR: any[] } = {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      OR: [...conditions],
    };

    const one = 1;
    const findPromise = this.prisma.user.findMany({
      where: this.hasCondition(query) ? where : undefined,
      take: limit,
      skip: limit * (page - one),
    });

    const totalPromise = this.prisma.user.count(this.hasCondition(query) ? { where } : undefined);
    const [users, total] = await this.prisma.$transaction([findPromise, totalPromise]);
    return new Pagination<UserDto>(users, page, limit, total);
  }

  hasCondition = (query: FindUsersQuery): boolean => {
    return !!query.search;
  };
}
