import { Test } from '@nestjs/testing';
import { PrismaService, UserIsUsernameFreeQuery } from '@seed/back/api/shared';
import { mockUsers } from '@seed/shared/mock-data';
import { UserIsUsernameFreeQueryHandler } from './userIsUsernameFree.queryHandler';

describe(UserIsUsernameFreeQueryHandler.name, () => {
  //region VARIABLES
  const findFirstMock = jest.fn(filter => mockUsers.find(u => u.userName === filter.where.userName) || null);
  let handler: UserIsUsernameFreeQueryHandler;
  const prismaServiceMock = jest.fn().mockImplementation(() => ({
    user: {
      findFirst: findFirstMock,
    },
  }));
  //endregion

  //region SETUP
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [UserIsUsernameFreeQueryHandler, { provide: PrismaService, useClass: prismaServiceMock }],
    }).compile();
    handler = moduleRef.get(UserIsUsernameFreeQueryHandler);
  });

  function runTest(options: { testName: string; userName: string; result: boolean }): void {
    it(options.testName, async () => {
      expect(await handler.execute(new UserIsUsernameFreeQuery(options.userName))).toEqual(options.result);
      expect(findFirstMock).toBeCalledWith({
        where: {
          userName: options.userName,
        },
        select: {
          id: true,
        },
      });
    });
  }

  //endregion

  runTest({
    testName: `should return true when no user in DB`,
    userName: 'fake',
    result: true,
  });

  runTest({
    testName: `should return false when user exists in DB`,
    userName: mockUsers[0].userName,
    result: false,
  });
});
