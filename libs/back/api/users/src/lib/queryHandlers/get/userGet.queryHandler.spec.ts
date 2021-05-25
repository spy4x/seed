import { Test } from '@nestjs/testing';
import { UserGetQuery, PrismaService } from '@seed/back/api/shared';
import { UserGetQueryHandler } from './userGet.queryHandler';
import { mockUsers } from '@seed/shared/mock-data';

describe('UserGetQueryHandler', () => {
  const [user] = mockUsers;
  const findUniqueMock = jest.fn();
  const query = new UserGetQuery(user.id);
  let findCurrentUserHandler: UserGetQueryHandler;
  const prismaServiceMock = jest.fn().mockImplementation(() => ({
    user: {
      findUnique: findUniqueMock,
    },
  }));

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [UserGetQueryHandler, { provide: PrismaService, useClass: prismaServiceMock }],
    }).compile();

    findCurrentUserHandler = moduleRef.get(UserGetQueryHandler);
  });

  describe('execute', () => {
    it('should be defined', () => {
      expect(findCurrentUserHandler).toBeDefined();
    });

    it('should execute findUnique with expected arguments', async () => {
      await findCurrentUserHandler.execute(query);
      const expected = {
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
      };
      expect(findUniqueMock).toBeCalledWith(expected);
    });

    it('should return null when findUnique returns null', async () => {
      findUniqueMock.mockReturnValue(null);
      expect(await findCurrentUserHandler.execute(query)).toBeNull();
    });

    it('should return UserDetailsDto when findUnique returns a user', async () => {
      findUniqueMock.mockReturnValue(user);
      expect(await findCurrentUserHandler.execute(query)).toStrictEqual(user);
    });
  });
});
