import { Test } from '@nestjs/testing';
import { UserGetQuery, PrismaService } from '@seed/back/api/shared';
import { UserGetQueryHandler } from './userGet.queryHandler';
import { mockUsers } from '@seed/shared/mock-data';
import { User } from '@prisma/client';

describe('UserGetQueryHandler', () => {
  //region VARIABLES
  const findUniqueMock = jest.fn(filter => mockUsers.find(u => u.id === filter.where.id) || null);
  let handler: UserGetQueryHandler;
  const prismaServiceMock = jest.fn().mockImplementation(() => ({
    user: {
      findUnique: findUniqueMock,
    },
  }));
  //endregion

  //region SETUP
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [UserGetQueryHandler, { provide: PrismaService, useClass: prismaServiceMock }],
    }).compile();
    handler = moduleRef.get(UserGetQueryHandler);
  });
  function runTest(options: { testName: string; userId: string; result: null | User }): void {
    it(options.testName, async () => {
      expect(await handler.execute(new UserGetQuery(options.userId))).toEqual(options.result);
      expect(findUniqueMock).toBeCalledWith({
        where: {
          id: options.userId,
        },
      });
    });
  }
  //endregion

  runTest({
    testName: `should return null when no user in DB`,
    userId: 'fake',
    result: null,
  });

  runTest({
    testName: `should return found User from DB`,
    userId: mockUsers[0].id,
    result: mockUsers[0],
  });
});
