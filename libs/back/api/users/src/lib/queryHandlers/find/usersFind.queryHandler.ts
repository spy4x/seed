import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { ListHandler, PaginationResponseDTO, PrismaService, UserDTO, UsersFindQuery } from '@seed/back/api/shared';
import { Prisma } from '@prisma/client';
import { ONE } from '@seed/shared/constants';

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
    const where: { OR: Prisma.UserWhereInput[] } = {
      OR: [...conditions],
    };

    const findPromise = this.prisma.user.findMany({
      where: this.hasCondition(query) ? where : undefined,
      take: limit,
      skip: limit * (page - ONE),
    });

    const totalPromise = this.prisma.user.count(this.hasCondition(query) ? { where } : undefined);
    const [users, total] = await this.prisma.$transaction([findPromise, totalPromise]);
    return new PaginationResponseDTO<UserDTO>(users, page, limit, total);
  }

  hasCondition = (query: UsersFindQuery): boolean => {
    return !!query.search;
  };
}
