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

  let deleteUserHandler: UserDeleteCommandHandler;

  const command = new UserDeleteCommand(user.id);

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [UserDeleteCommandHandler, { provide: PrismaService, useClass: prismaServiceMock }],
    }).compile();

    deleteUserHandler = moduleRef.get(UserDeleteCommandHandler);
  });

  describe('execute', () => {
    it('should be defined', () => {
      expect(deleteUserHandler).toBeDefined();
    });
    it('should execute delete with expected arguments', async () => {
      const expected = {
        where: {
          id: command.id,
        },
      };
      await deleteUserHandler.execute(command);
      expect(deleteMock).toBeCalledWith(expected);
    });
  });
});
