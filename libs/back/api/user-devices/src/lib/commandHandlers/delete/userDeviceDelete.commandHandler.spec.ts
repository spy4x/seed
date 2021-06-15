import { Test } from '@nestjs/testing';
import { PrismaService, UserDeviceDeleteCommand } from '@seed/back/api/shared';
import { UserDeviceDeleteCommandHandler } from './userDeviceDelete.commandHandler';
import { mockUserDevices } from '@seed/shared/mock-data';

describe('UserDeviceDeleteCommandHandler', () => {
  //region VARIABLES
  const [userDevice] = mockUserDevices;
  const findFirstMock = jest.fn();
  const deleteMock = jest.fn(() => userDevice);
  const prismaServiceMock = jest.fn().mockImplementation(() => ({
    userDevice: {
      findFirst: findFirstMock,
      delete: deleteMock,
    },
  }));
  let handler: UserDeviceDeleteCommandHandler;
  const command = new UserDeviceDeleteCommand(userDevice.id, '123');
  //endregion

  //region SETUP
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [UserDeviceDeleteCommandHandler, { provide: PrismaService, useClass: prismaServiceMock }],
    }).compile();
    handler = moduleRef.get(UserDeviceDeleteCommandHandler);
  });
  //endregion

  it('should find existing device by this id and userId, return null if nothing found', async () => {
    findFirstMock.mockReturnValueOnce(null);
    expect(await handler.execute(command)).toEqual(null);
    expect(findFirstMock).toBeCalledWith({
      where: {
        id: command.id,
        userId: command.currentUserId,
      },
    });
    expect(deleteMock).not.toBeCalled();
  });

  it('should find existing device by this id and userId, and if it is found - delete it and return deleted userDevice', async () => {
    findFirstMock.mockReturnValueOnce(userDevice);
    expect(await handler.execute(command)).toEqual(userDevice);
    expect(findFirstMock).toBeCalledWith({
      where: {
        id: command.id,
        userId: command.currentUserId,
      },
    });
    expect(deleteMock).toBeCalledWith({
      where: {
        id: command.id,
      },
    });
  });
});
