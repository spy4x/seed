import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService, UserDeviceCreateCommand } from '@seed/back/api/shared';
import { UserDeviceCreateCommandHandler } from './userDeviceCreate.commandHandler';
import { mockUserDevices } from '@seed/shared/mock-data';
import { UserDevice } from '@prisma/client';

describe('UserDeviceCreateCommandHandler', () => {
  const prismaUserDeviceFindFirstMock = jest.fn();
  const prismaUserDeviceCreateMock = jest.fn();
  const prismaServiceMock = jest.fn().mockImplementation(() => ({
    userDevice: {
      findFirst: prismaUserDeviceFindFirstMock,
      create: prismaUserDeviceCreateMock,
    },
  }));

  let userDeviceCreateCommandHandler: UserDeviceCreateCommandHandler;

  const [userDevice] = mockUserDevices;
  const command = new UserDeviceCreateCommand(
    userDevice.userId,
    userDevice.fcmToken,
    userDevice.deviceId || undefined,
    userDevice.deviceName || undefined,
  );

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [UserDeviceCreateCommandHandler, { provide: PrismaService, useClass: prismaServiceMock }],
    }).compile();

    userDeviceCreateCommandHandler = moduleRef.get(UserDeviceCreateCommandHandler);
  });

  describe('execute', () => {
    it('should find existing device by this fcmToken and userId, and throw ConflictException if something was found', async () => {
      prismaUserDeviceFindFirstMock.mockReturnValueOnce(userDevice);
      await expect(userDeviceCreateCommandHandler.execute(command)).rejects.toThrow(ConflictException);
      expect(prismaUserDeviceFindFirstMock).toBeCalledWith({
        where: {
          fcmToken: command.fcmToken,
          userId: command.userId,
        },
      });
      expect(prismaUserDeviceCreateMock).not.toBeCalled();
    });

    it('should find existing device by this fcmToken and userId, and create UserDevice if nothing was found, and return created UserDevice', async () => {
      prismaUserDeviceFindFirstMock.mockReturnValueOnce(null);
      const now = new Date();
      const createdUserDevice: UserDevice = {
        id: '123',
        ...command,
        createdAt: now,
        updatedAt: now,
      };
      prismaUserDeviceCreateMock.mockReturnValueOnce(createdUserDevice);
      expect(await userDeviceCreateCommandHandler.execute(command)).toStrictEqual(createdUserDevice);
      expect(prismaUserDeviceFindFirstMock).toBeCalledWith({
        where: {
          fcmToken: command.fcmToken,
          userId: command.userId,
        },
      });
      expect(prismaUserDeviceCreateMock).toBeCalledWith({ data: command });
    });
  });
});
