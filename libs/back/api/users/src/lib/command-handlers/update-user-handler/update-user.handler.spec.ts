import { Test } from '@nestjs/testing';
import { AddUserDeviceDto, UpdateUserCommand, PrismaService, usersMock, userDevices } from '@seed/back/api/shared';
import { UpdateUserHandler } from './update-user.handler';

describe('UpdateUserHandler', () => {
  const [user] = usersMock;
  const updateMock = jest.fn(() => user);
  let updateUserHandler: UpdateUserHandler;
  const devices: AddUserDeviceDto | undefined = undefined;
  const prismaServiceMock = jest.fn().mockImplementation(() => ({
    user: {
      update: updateMock,
    },
  }));

  const command = new UpdateUserCommand(
    user.id,
    user.userName,
    user.firstName,
    user.lastName,
    user.photoURL as string,
    devices,
    true,
  );

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [UpdateUserHandler, { provide: PrismaService, useClass: prismaServiceMock }],
    }).compile();

    updateUserHandler = moduleRef.get(UpdateUserHandler);
  });

  describe('execute', () => {
    it('should be defined', () => {
      expect(updateUserHandler).toBeDefined();
    });
    it('should call prism.user.update with expected arguments', async () => {
      const { id, firstName, lastName, userName, photoURL, isPushNotificationsEnabled } = command;
      await updateUserHandler.execute(command);
      const expected = {
        where: {
          id,
        },
        data: {
          userName,
          firstName,
          lastName,
          photoURL,
          isPushNotificationsEnabled,
        },
      };
      expect(updateMock).toBeCalledWith(expected);
    });

    it('should add create user device when userDevice object is defined', async () => {
      const _userDevice: AddUserDeviceDto = {
        fcmToken: userDevices[0].fcmToken,
        deviceId: userDevices[0].deviceId as string,
        deviceName: userDevices[0].deviceName as string,
      };
      command.userDevice = _userDevice;

      await updateUserHandler.execute(command);

      const { id, firstName, lastName, userName, photoURL, userDevice, isPushNotificationsEnabled } = command;

      const expected = {
        where: {
          id,
        },
        data: {
          userName,
          firstName,
          lastName,
          photoURL,
          isPushNotificationsEnabled,
          userDevices: {
            upsert: {
              create: {
                ...userDevice,
              },
              update: {
                ...userDevice,
              },
              where: {
                // eslint-disable-next-line @typescript-eslint/naming-convention
                fcmToken_userId: {
                  fcmToken: userDevice.fcmToken,
                  userId: id,
                },
              },
            },
          },
        },
      };
      expect(updateMock).toBeCalledWith(expected);
    });
  });
});
