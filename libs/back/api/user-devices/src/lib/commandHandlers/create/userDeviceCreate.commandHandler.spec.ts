import { ConflictException } from '@nestjs/common';
import { UserDeviceCreateCommand, UserDeviceCreatedEvent } from '@seed/back/api/shared';
import { UserDeviceCreateCommandHandler } from './userDeviceCreate.commandHandler';
import { mockUserDevices } from '@seed/shared/mock-data';
import { UserDevice } from '@prisma/client';

describe(UserDeviceCreateCommandHandler.name, () => {
  //region VARIABLES
  const findFirstMock = jest.fn();
  const createMock = jest.fn();
  const publishMock = jest.fn();
  const [userDevice] = mockUserDevices;
  const command = new UserDeviceCreateCommand(
    userDevice.userId,
    userDevice.fcmToken,
    userDevice.deviceId || undefined,
    userDevice.deviceName || undefined,
  );
  const handler = new UserDeviceCreateCommandHandler(
    {
      userDevice: {
        findFirst: findFirstMock,
        create: createMock,
      },
    } as any,
    {
      publish: publishMock,
    } as any,
  );
  beforeEach(() => {
    findFirstMock.mockClear();
    createMock.mockClear();
    publishMock.mockClear();
  });
  //endregion

  it('should find existing device by this fcmToken and userId, and throw ConflictException if something was found', async () => {
    findFirstMock.mockReturnValueOnce(userDevice);
    await expect(handler.execute(command)).rejects.toThrow(ConflictException);
    expect(findFirstMock).toBeCalledWith({
      where: {
        fcmToken: command.fcmToken,
        userId: command.userId,
      },
    });
    expect(createMock).not.toBeCalled();
  });

  it('should find existing device by this fcmToken and userId, and create UserDevice if nothing was found, and return created UserDevice', async () => {
    findFirstMock.mockReturnValueOnce(null);
    const now = new Date();
    const createdUserDevice: UserDevice = {
      id: '123',
      ...command,
      createdAt: now,
      updatedAt: now,
    };
    createMock.mockReturnValueOnce(createdUserDevice);
    expect(await handler.execute(command)).toStrictEqual(createdUserDevice);
    expect(findFirstMock).toBeCalledWith({
      where: {
        fcmToken: command.fcmToken,
        userId: command.userId,
      },
    });
    expect(createMock).toBeCalledWith({ data: command });
    expect(publishMock).toBeCalledWith(new UserDeviceCreatedEvent(createdUserDevice));
  });
});
