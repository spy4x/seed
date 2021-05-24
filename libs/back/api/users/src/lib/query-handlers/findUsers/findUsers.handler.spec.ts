import { Test } from '@nestjs/testing';
import { FindUsersQuery, Pagination, PrismaService, UserDto, usersMock } from '@seed/back/api/shared';
import { FindUsersHandler } from './findUsers.handler';

describe('FindUsersHandler', () => {
  let getUsersHandler: FindUsersHandler;
  let query: FindUsersQuery;

  const findManyMock = jest.fn().mockImplementation(() => []);
  const countMock = jest.fn();

  const prismaServiceMock = jest.fn().mockImplementation(() => ({
    user: {
      findMany: findManyMock,
      count: countMock,
    },
  }));

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        FindUsersHandler,
        {
          provide: PrismaService,
          useClass: prismaServiceMock,
        },
      ],
    }).compile();
    getUsersHandler = moduleRef.get(FindUsersHandler);
  });

  it('should call prisma.user.findMany with expected arguments', async () => {
    query = new FindUsersQuery(1, 20);
    query.currentUserId = '123';

    const expected = {
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    };
    await getUsersHandler.execute(query);
    expect(findManyMock).toBeCalledWith(expected);
  });

  it('should call prisma.findMany with search query condition when provided in arguments', async () => {
    query = new FindUsersQuery(1, 20);
    query.currentUserId = '123';
    query.search = 'JohnDoe';

    const expected = {
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      where: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        OR: [
          {
            userName: {
              contains: query.search,
            },
            firstName: {
              contains: query.search,
            },
            lastName: {
              contains: query.search,
            },
          },
        ],
      },
    };
    await getUsersHandler.execute(query);
    expect(findManyMock).toBeCalledWith(expected);
  });
  it('should call prisma.findMany with username split by space when username value has multiple words', async () => {
    query = new FindUsersQuery(1, 20);
    query.currentUserId = '123';
    query.search = 'John Doe Doeson';
    const qSplit = query.search.split(' ');

    const expected = {
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      where: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        OR: qSplit.map(word => ({
          userName: {
            contains: word,
          },
          firstName: {
            contains: word,
          },
          lastName: {
            contains: word,
          },
        })),
      },
    };
    await getUsersHandler.execute(query);
    expect(findManyMock).toBeCalledWith(expected);
  });
  it('should return UserDto', async () => {
    countMock.mockImplementation(() => 20);
    const page = 1;
    const limit = 20;

    query = new FindUsersQuery(page, limit);
    query.currentUserId = '123';
    query.search = 'John';

    findManyMock.mockImplementation(() => usersMock);

    const expected = new Pagination<UserDto>(usersMock, page, limit, 20);

    const result = await getUsersHandler.execute(query);
    expect(result).toStrictEqual(expected);
  });
});
