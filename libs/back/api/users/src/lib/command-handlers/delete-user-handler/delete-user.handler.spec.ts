import { Test } from '@nestjs/testing';
import { DeleteUserCommand, PrismaService, usersMock } from '@seed/back/api/shared';
import { DeleteUserHandler } from './delete-user.handler';

describe('DeleteUserHandler', () => {
  const [user] = usersMock;

  const deleteMock = jest.fn(() => user);

  const prismaServiceMock = jest.fn().mockImplementation(() => ({
    user: {
      delete: deleteMock,
    },
  }));

  let deleteUserHandler: DeleteUserHandler;

  const command = new DeleteUserCommand(user.id);

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [DeleteUserHandler, { provide: PrismaService, useClass: prismaServiceMock }],
    }).compile();

    deleteUserHandler = moduleRef.get(DeleteUserHandler);
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
