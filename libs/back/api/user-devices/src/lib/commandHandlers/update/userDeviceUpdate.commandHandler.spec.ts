import { UserDeviceUpdateCommand, UserDeviceUpdatedEvent } from '@seed/back/api/shared';
import { UserDeviceUpdateCommandHandler } from './userDeviceUpdate.commandHandler';
import { mockUserDevices } from '@seed/shared/mock-data';
import { UserDevice } from '@prisma/client';

describe(UserDeviceUpdateCommandHandler.name, () => {
  //region SETUP
  const [userDevice] = mockUserDevices;
  const findFirstMock = jest.fn();
  const updateMock = jest.fn();
  const publishMock = jest.fn();
  const command = new UserDeviceUpdateCommand(
    userDevice.id,
    userDevice.userId,
    userDevice.deviceId || undefined,
    userDevice.deviceName || undefined,
  );
  const handler = new UserDeviceUpdateCommandHandler(
    {
      userDevice: {
        findFirst: findFirstMock,
        update: updateMock,
      },
    } as any,
    {
      publish: publishMock,
    } as any,
  );
  beforeEach(() => {
    findFirstMock.mockClear();
    updateMock.mockClear();
    publishMock.mockClear();
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
    expect(updateMock).not.toBeCalled();
  });

  it('should find existing device by this id and userId, and if it is found - update it and return updated userDevice', async () => {
    findFirstMock.mockReturnValueOnce(userDevice);
    const { id, deviceId, deviceName } = command;
    const updatedUserDevice: UserDevice = {
      ...userDevice,
      id,
      fcmToken: userDevice.fcmToken,
      deviceId: deviceId || null,
      deviceName: deviceName || null,
    };
    updateMock.mockReturnValueOnce(updatedUserDevice);
    expect(await handler.execute(command)).toEqual(updatedUserDevice);
    expect(findFirstMock).toBeCalledWith({
      where: {
        id: command.id,
        userId: command.currentUserId,
      },
    });
    expect(updateMock).toBeCalledWith({
      where: {
        id: command.id,
      },
      data: { deviceId, deviceName },
    });
    expect(publishMock).toBeCalledWith(new UserDeviceUpdatedEvent(updatedUserDevice));
  });
});
