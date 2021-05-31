import { Test } from '@nestjs/testing';
import { UserGetMeQuery, PrismaService } from '@seed/back/api/shared';
import { UserGetMeQueryHandler } from './userGetMe.queryHandler';
import { mockUsers } from '@seed/shared/mock-data';

describe('UserGetMeQueryHandler', () => {
  const [user] = mockUsers;
  const findUniqueMock = jest.fn();
  const query = new UserGetMeQuery(user.id);
  const prismaServiceMock = jest.fn().mockImplementation(() => ({
    user: {
      findUnique: findUniqueMock,
    },
  }));
  let findCurrentUserHandler: UserGetMeQueryHandler;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [UserGetMeQueryHandler, { provide: PrismaService, useClass: prismaServiceMock }],
    }).compile();

    findCurrentUserHandler = moduleRef.get(UserGetMeQueryHandler);
  });

  describe('execute', () => {
    it('should be defined', () => {
      expect(findCurrentUserHandler).toBeDefined();
    });

    it('should execute findUnique with expected arguments', async () => {
      await findCurrentUserHandler.execute(query);
      const expected = {
        where: {
          id: query.id,
        },
      };
      expect(findUniqueMock).toBeCalledWith(expected);
    });

    it('should return null when findUnique returns null', async () => {
      findUniqueMock.mockImplementation(() => null);
      const result = await findCurrentUserHandler.execute(query);
      expect(result).toBeNull();
    });

    it('should return CurrentUserDto object when findUnique returns a user', async () => {
      findUniqueMock.mockImplementation(() => user);
      const result = await findCurrentUserHandler.execute(query);
      expect(result).toStrictEqual(user);
    });
  });
});
