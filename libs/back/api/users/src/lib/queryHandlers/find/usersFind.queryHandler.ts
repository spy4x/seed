import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import {
  UsersFindQuery,
  ListHandler,
  LogService,
  PaginationResponseDTO,
  PrismaService,
  UserDTO,
} from '@seed/back/api/shared';
import { Prisma } from '@prisma/client';

@QueryHandler(UsersFindQuery)
export class UsersFindQueryHandler extends ListHandler implements IQueryHandler<UsersFindQuery> {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async execute(query: UsersFindQuery): Promise<PaginationResponseDTO<UserDTO>> {
    const { search } = query;
    const { page, limit } = this.getPaginationData(query);
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
    // eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-explicit-any
    const where: { OR: Prisma.UserWhereInput[] } = {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      OR: [...conditions],
    };

    const one = 1;
    console.log(LogService.inspect({ query, where, limit }));
    const findPromise = this.prisma.user.findMany({
      where: this.hasCondition(query) ? where : undefined,
      take: limit,
      skip: limit * (page - one),
    });

    const totalPromise = this.prisma.user.count(this.hasCondition(query) ? { where } : undefined);
    const [users, total] = await this.prisma.$transaction([findPromise, totalPromise]);
    return new PaginationResponseDTO<UserDTO>(users, page, limit, total);
  }

  hasCondition = (query: UsersFindQuery): boolean => {
    return !!query.search;
  };
}
