import { BadRequestException } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { Test } from '@nestjs/testing';
import { UserDeviceCreateDTO, UserCreateCommand, PrismaService } from '@seed/back/api/shared';
import { UserCreateCommandHandler } from './userCreate.commandHandler';
import { mockUsers, mockUserDevices } from '@seed/shared/mock-data';

describe('UserCreateCommandHandler', () => {
  const [user] = mockUsers;

  const createMock = jest.fn(() => user);
  const findFirstMock = jest.fn();

  const prismaServiceMock = jest.fn().mockImplementation(() => ({
    user: {
      create: createMock,
      findFirst: findFirstMock,
    },
  }));
  const eventBusMock = jest.fn().mockImplementation(() => ({
    publish: jest.fn(),
  }));

  let userCreateCommandHandler: UserCreateCommandHandler;
  const device: UserDeviceCreateDTO | null = null;

  const command = new UserCreateCommand(
    user.id,
    user.userName,
    user.firstName,
    user.lastName,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    device || undefined,
    user.photoURL as string,
    user.isPushNotificationsEnabled,
  );

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        UserCreateCommandHandler,
        { provide: PrismaService, useClass: prismaServiceMock },
        { provide: EventBus, useClass: eventBusMock },
      ],
    }).compile();

    userCreateCommandHandler = moduleRef.get(UserCreateCommandHandler);
  });

  describe('execute', () => {
    it('should be defined', () => {
      expect(userCreateCommandHandler).toBeDefined();
    });

    it('should call prisma.user.create with expected arguments', async () => {
      const { id, firstName, lastName, userName, photoURL, isPushNotificationsEnabled } = command;
      await userCreateCommandHandler.execute(command);

      const data = {
        id,
        firstName,
        lastName,
        userName,
        photoURL,
        isPushNotificationsEnabled,
      };
      expect(createMock).toBeCalledWith({ data });
    });

    it('should prisma.user.create with userDevice if userDevice is defined', async () => {
      command.userDevice = {
        fcmToken: mockUserDevices[0].fcmToken,
        deviceId: mockUserDevices[0].deviceId as string,
        deviceName: mockUserDevices[0].deviceName as string,
      };

      const { id, firstName, lastName, userName, userDevice, photoURL, isPushNotificationsEnabled } = command;
      await userCreateCommandHandler.execute(command);
      const createUserDevice = {
        userDevices: {
          create: {
            ...userDevice,
          },
        },
      };

      const data = {
        id,
        firstName,
        lastName,
        userName,
        photoURL,
        isPushNotificationsEnabled,
        ...createUserDevice,
      };
      expect(createMock).toBeCalledWith({ data });
    });

    it('should throw BadRequestException when prisma.findFirst returns a value', async () => {
      findFirstMock.mockImplementation(() => mockUsers[1]);
      await expect(userCreateCommandHandler.execute(command)).rejects.toThrow(BadRequestException);
    });

    it('should return UserDetailsDto', async () => {
      findFirstMock.mockImplementation(() => null);
      const createdUser = await userCreateCommandHandler.execute(command);
      expect(createdUser).toStrictEqual(mockUsers[0]);
    });
  });
});
