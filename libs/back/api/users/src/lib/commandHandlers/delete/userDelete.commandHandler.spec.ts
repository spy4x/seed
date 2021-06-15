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
  let handler: UserDeleteCommandHandler;
  const command = new UserDeleteCommand(user.id);
  //endregion

  //region SETUP
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [UserDeleteCommandHandler, { provide: PrismaService, useClass: prismaServiceMock }],
    }).compile();
    handler = moduleRef.get(UserDeleteCommandHandler);
  });
  //endregion

  it('should execute delete with expected arguments and return deleted userDevice', async () => {
    const expected = {
      where: {
        id: command.id,
      },
    };
    expect(await handler.execute(command)).toEqual(user);
    expect(deleteMock).toBeCalledWith(expected);
  });
});
