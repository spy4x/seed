import { UserDeviceDeleteCommand, UserDeviceDeletedEvent } from '@seed/back/api/shared';
import { UserDeviceDeleteCommandHandler } from './userDeviceDelete.commandHandler';
import { mockUserDevices } from '@seed/shared/mock-data';

describe(UserDeviceDeleteCommandHandler.name, () => {
  //region SETUP
  const [userDevice] = mockUserDevices;
  const findFirstMock = jest.fn();
  const deleteMock = jest.fn(() => userDevice);
  const prismaServiceMock = {
    userDevice: {
      findFirst: findFirstMock,
      delete: deleteMock,
    },
  };
  const publishMock = jest.fn();
  const eventBusMock = {
    publish: publishMock,
  };
  const command = new UserDeviceDeleteCommand(userDevice.id, '123');
  const handler = new UserDeviceDeleteCommandHandler(prismaServiceMock as any, eventBusMock as any);

  afterEach(() => {
    findFirstMock.mockClear();
    deleteMock.mockClear();
    findFirstMock.mockClear();
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
    expect(publishMock).toBeCalledWith(new UserDeviceDeletedEvent(userDevice));
  });
});
