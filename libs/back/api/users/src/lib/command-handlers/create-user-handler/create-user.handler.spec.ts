import { BadRequestException } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { Test } from '@nestjs/testing';
import { AddUserDeviceDto, CreateUserCommand, PrismaService, userDevices, usersMock } from '@seed/back/api/shared';
import { CreateUserHandler } from './create-user.handler';

describe('CreateUserHandler', () => {
  const [user] = usersMock;

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

  let createUserHandler: CreateUserHandler;
  const device: AddUserDeviceDto | null = null;

  const command = new CreateUserCommand(
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
        CreateUserHandler,
        { provide: PrismaService, useClass: prismaServiceMock },
        { provide: EventBus, useClass: eventBusMock },
      ],
    }).compile();

    createUserHandler = moduleRef.get(CreateUserHandler);
  });

  describe('execute', () => {
    it('should be defined', () => {
      expect(createUserHandler).toBeDefined();
    });

    it('should call prisma.user.create with expected arguments', async () => {
      const { id, firstName, lastName, userName, photoURL, isPushNotificationsEnabled } = command;
      await createUserHandler.execute(command);

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
        fcmToken: userDevices[0].fcmToken,
        deviceId: userDevices[0].deviceId as string,
        deviceName: userDevices[0].deviceName as string,
      };

      const { id, firstName, lastName, userName, userDevice, photoURL, isPushNotificationsEnabled } = command;
      await createUserHandler.execute(command);
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
      findFirstMock.mockImplementation(() => usersMock[1]);
      await expect(createUserHandler.execute(command)).rejects.toThrow(BadRequestException);
    });

    it('should return UserDetailsDto', async () => {
      findFirstMock.mockImplementation(() => null);
      const createdUser = await createUserHandler.execute(command);
      // expect(createdUser).toBeInstanceOf(UserDetailsDto);
      expect(createdUser).toStrictEqual(usersMock[0]);
    });
  });
});
