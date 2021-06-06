import { Test } from '@nestjs/testing';
import { PrismaService, UserDeviceUpdateCommand } from '@seed/back/api/shared';
import { UserDeviceUpdateCommandHandler } from './userDeviceUpdate.commandHandler';
import { mockUserDevices } from '@seed/shared/mock-data';
import { UserDevice } from '@prisma/client';

describe('UserDeviceUpdateCommandHandler', () => {
  const [userDevice] = mockUserDevices;
  const findFirstMock = jest.fn();
  const updateMock = jest.fn();
  const prismaServiceMock = jest.fn().mockImplementation(() => ({
    userDevice: {
      findFirst: findFirstMock,
      update: updateMock,
    },
  }));

  const command = new UserDeviceUpdateCommand(
    userDevice.id,
    userDevice.userId,
    userDevice.deviceId || undefined,
    userDevice.deviceName || undefined,
  );
  let userDeviceUpdateCommandHandler: UserDeviceUpdateCommandHandler;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [UserDeviceUpdateCommandHandler, { provide: PrismaService, useClass: prismaServiceMock }],
    }).compile();

    userDeviceUpdateCommandHandler = moduleRef.get(UserDeviceUpdateCommandHandler);
  });

  describe('execute', () => {
    it('should find existing device by this id and userId, return null if nothing found', async () => {
      findFirstMock.mockReturnValueOnce(null);
      expect(await userDeviceUpdateCommandHandler.execute(command)).toEqual(null);
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
      expect(await userDeviceUpdateCommandHandler.execute(command)).toEqual(updatedUserDevice);
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
    });
  });
});
