import { Test } from '@nestjs/testing';
import { PaginationResponseDTO, PrismaService, UserDTO, UsersFindQuery } from '@seed/back/api/shared';
import { UsersFindQueryHandler } from './usersFind.queryHandler';
import { mockUsers } from '@seed/shared/mock-data';
import { ONE, PAGINATION_DEFAULTS } from '@seed/shared/constants';

describe('UsersFindQueryHandler', () => {
  let getUsersHandler: UsersFindQueryHandler;
  const page = 3;
  const limit = 50;
  const findManyMockResult = mockUsers;
  const countMockResult = mockUsers.length;
  const findManyMock = jest.fn().mockReturnValue(findManyMockResult);
  const countMock = jest.fn().mockReturnValue(countMockResult);
  const transactionMock = jest.fn().mockReturnValue([findManyMockResult, countMockResult]);

  const prismaServiceMock = jest.fn().mockImplementation(() => ({
    user: {
      findMany: findManyMock,
      count: countMock,
    },
    $transaction: transactionMock,
  }));

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersFindQueryHandler,
        {
          provide: PrismaService,
          useClass: prismaServiceMock,
        },
      ],
    }).compile();
    getUsersHandler = moduleRef.get(UsersFindQueryHandler);
    findManyMock.mockClear();
    countMock.mockClear();
    transactionMock.mockClear();
  });

  function getQuery(
    pageArg = PAGINATION_DEFAULTS.page,
    limitArg = PAGINATION_DEFAULTS.limit,
    search?: string,
  ): UsersFindQuery {
    return new UsersFindQuery(pageArg, limitArg, search);
  }

  it('should call prisma.user.findMany(), prisma.user.count(), prisma.$transaction() with basic params when no search query is provided', async () => {
    const result = await getUsersHandler.execute(getQuery(page, limit));

    expect(findManyMock).toBeCalledWith({
      skip: (page - ONE) * limit,
      take: limit,
    });
    expect(countMock).toHaveBeenCalledWith(undefined);
    expect(transactionMock).toHaveBeenCalledWith([findManyMockResult, countMockResult]);

    expect(result).toEqual(new PaginationResponseDTO<UserDTO>(findManyMockResult, page, limit, countMockResult));
  });

  it('should call prisma.user.findMany(), prisma.user.count() with basic params + search query condition for single word', async () => {
    const query = getQuery(page, limit);
    query.search = 'John';
    const result = await getUsersHandler.execute(query);
    const where = {
      OR: [
        {
          userName: {
            contains: 'John',
            mode: 'insensitive',
          },
        },
        {
          firstName: {
            contains: 'John',
            mode: 'insensitive',
          },
        },
        {
          lastName: {
            contains: 'John',
            mode: 'insensitive',
          },
        },
      ],
    };
    expect(findManyMock).toBeCalledWith({
      skip: (page - ONE) * limit,
      take: limit,
      where,
    });
    expect(countMock).toHaveBeenCalledWith({ where });
    expect(result).toEqual(new PaginationResponseDTO<UserDTO>(findManyMockResult, page, limit, countMockResult));
  });

  it('should call prisma.user.findMany(), prisma.user.count() with basic params + search query condition for multiple words', async () => {
    const query = getQuery(page, limit);
    query.search = 'John Wick';
    const result = await getUsersHandler.execute(query);
    const where = {
      OR: [
        {
          userName: {
            contains: 'John',
            mode: 'insensitive',
          },
        },
        {
          firstName: {
            contains: 'John',
            mode: 'insensitive',
          },
        },
        {
          lastName: {
            contains: 'John',
            mode: 'insensitive',
          },
        },
        {
          userName: {
            contains: 'Wick',
            mode: 'insensitive',
          },
        },
        {
          firstName: {
            contains: 'Wick',
            mode: 'insensitive',
          },
        },
        {
          lastName: {
            contains: 'Wick',
            mode: 'insensitive',
          },
        },
      ],
    };
    expect(findManyMock).toBeCalledWith({
      skip: (page - ONE) * limit,
      take: limit,
      where,
    });
    expect(countMock).toHaveBeenCalledWith({ where });
    expect(result).toEqual(new PaginationResponseDTO<UserDTO>(findManyMockResult, page, limit, countMockResult));
  });
});
