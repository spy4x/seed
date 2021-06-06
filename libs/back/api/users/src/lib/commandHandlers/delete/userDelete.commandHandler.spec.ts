import { Test } from '@nestjs/testing';
import { UserDeleteCommand, PrismaService } from '@seed/back/api/shared';
import { UserDeleteCommandHandler } from './userDelete.commandHandler';
import { mockUsers } from '@seed/shared/mock-data';

describe('UserDeleteCommandHandler', () => {
  const [user] = mockUsers;

  const deleteMock = jest.fn(() => user);

  const prismaServiceMock = jest.fn().mockImplementation(() => ({
    user: {
      delete: deleteMock,
    },
  }));

  let userDeleteCommandHandler: UserDeleteCommandHandler;

  const command = new UserDeleteCommand(user.id);

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [UserDeleteCommandHandler, { provide: PrismaService, useClass: prismaServiceMock }],
    }).compile();

    userDeleteCommandHandler = moduleRef.get(UserDeleteCommandHandler);
  });

  describe('execute', () => {
    it('should execute delete with expected arguments and return deleted userDevice', async () => {
      const expected = {
        where: {
          id: command.id,
        },
      };
      expect(await userDeleteCommandHandler.execute(command)).toEqual(user);
      expect(deleteMock).toBeCalledWith(expected);
    });
  });
});
