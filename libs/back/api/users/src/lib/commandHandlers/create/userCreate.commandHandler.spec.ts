import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventBusExt, PrismaService, UserCreateCommand, UserCreatedEvent } from '@seed/back/api/shared';
import { UserCreateCommandHandler } from './userCreate.commandHandler';
import { mockUsers } from '@seed/shared/mock-data';
import { User, UserRole } from '@prisma/client';

describe('UserCreateCommandHandler', () => {
  const prismaUserCreateMock = jest.fn();
  const prismaUserFindFirstMock = jest.fn();
  const eventBusPublishMock = jest.fn();
  const prismaServiceMock = jest.fn().mockImplementation(() => ({
    user: {
      create: prismaUserCreateMock,
      findFirst: prismaUserFindFirstMock,
    },
  }));
  const eventBusMock = jest.fn().mockImplementation(() => ({
    publish: eventBusPublishMock,
  }));

  let userCreateCommandHandler: UserCreateCommandHandler;

  const [user] = mockUsers;
  const command = new UserCreateCommand(
    user.id,
    user.userName,
    user.firstName,
    user.lastName,
    user.photoURL as string,
    user.isPushNotificationsEnabled,
  );

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        UserCreateCommandHandler,
        { provide: PrismaService, useClass: prismaServiceMock },
        { provide: EventBusExt, useClass: eventBusMock },
      ],
    }).compile();

    userCreateCommandHandler = moduleRef.get(UserCreateCommandHandler);
  });

  describe('execute', () => {
    it('should throw ConflictException when prisma.user.findFirst returns a value', async () => {
      prismaUserFindFirstMock.mockReturnValueOnce(user);
      await expect(userCreateCommandHandler.execute(command)).rejects.toThrow(ConflictException);
    });

    it('should call prisma.user.create with expected arguments and publish event', async () => {
      prismaUserFindFirstMock.mockReturnValueOnce(null);
      const now = new Date();
      const createdUser: User = {
        ...command,
        lastTimeSignedIn: now,
        createdAt: now,
        updatedAt: now,
        role: UserRole.USER,
      };
      prismaUserCreateMock.mockReturnValueOnce(createdUser);
      await userCreateCommandHandler.execute(command);
      expect(prismaUserCreateMock).toBeCalledWith({ data: { ...command } });
      expect(eventBusPublishMock).toBeCalledWith(new UserCreatedEvent(createdUser));
    });

    it('should return created User', async () => {
      prismaUserFindFirstMock.mockReturnValueOnce(null);
      prismaUserCreateMock.mockReturnValueOnce(user);
      expect(await userCreateCommandHandler.execute(command)).toStrictEqual(user);
    });
  });
});
