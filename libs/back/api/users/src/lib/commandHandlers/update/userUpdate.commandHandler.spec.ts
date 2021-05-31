import { Test } from '@nestjs/testing';
import { UserDeviceCreateDTO, UserUpdateCommand, PrismaService } from '@seed/back/api/shared';
import { UserUpdateCommandHandler } from './userUpdate.commandHandler';
import { mockUsers, mockUserDevices } from '@seed/shared/mock-data';

describe('UpdateUserHandler', () => {
  const [user] = mockUsers;
  const updateMock = jest.fn(() => user);
  let updateUserHandler: UserUpdateCommandHandler;
  const devices: UserDeviceCreateDTO | undefined = undefined;
  const prismaServiceMock = jest.fn().mockImplementation(() => ({
    user: {
      update: updateMock,
    },
  }));

  const command = new UserUpdateCommand(
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
      providers: [UserUpdateCommandHandler, { provide: PrismaService, useClass: prismaServiceMock }],
    }).compile();

    updateUserHandler = moduleRef.get(UserUpdateCommandHandler);
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
      const _userDevice: UserDeviceCreateDTO = {
        fcmToken: mockUserDevices[0].fcmToken,
        deviceId: mockUserDevices[0].deviceId as string,
        deviceName: mockUserDevices[0].deviceName as string,
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
