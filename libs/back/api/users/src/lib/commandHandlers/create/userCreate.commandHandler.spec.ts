import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventBusExt, PrismaService, UserCreateCommand, UserCreatedEvent } from '@seed/back/api/shared';
import { UserCreateCommandHandler } from './userCreate.commandHandler';
import { mockUsers } from '@seed/shared/mock-data';

describe(UserCreateCommandHandler.name, () => {
  //region VARIABLES
  const prismaUserCreateMock = jest.fn();
  const prismaUserFindFirstMock = jest.fn();
  const prismaServiceMock = jest.fn().mockImplementation(() => ({
    user: {
      create: prismaUserCreateMock,
      findFirst: prismaUserFindFirstMock,
    },
  }));
  const eventBusPublishMock = jest.fn();
  const eventBusMock = jest.fn().mockImplementation(() => ({
    publish: eventBusPublishMock,
  }));
  let handler: UserCreateCommandHandler;
  const [user] = mockUsers;
  const command = new UserCreateCommand(
    user.id,
    user.userName,
    user.firstName,
    user.lastName,
    user.photoURL as string,
    user.isPushNotificationsEnabled,
  );
  //endregion

  //region SETUP
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        UserCreateCommandHandler,
        { provide: PrismaService, useClass: prismaServiceMock },
        { provide: EventBusExt, useClass: eventBusMock },
      ],
    }).compile();
    handler = moduleRef.get(UserCreateCommandHandler);
  });
  //endregion

  it('should throw ConflictException when prisma.user.findFirst returns a value', async () => {
    prismaUserFindFirstMock.mockReturnValueOnce(user);
    await expect(handler.execute(command)).rejects.toThrow(ConflictException);
  });

  it('should create user in DB, publish UserCreatedEvent, and return created user', async () => {
    prismaUserFindFirstMock.mockReturnValueOnce(null);
    const createdUser = user;
    prismaUserCreateMock.mockReturnValueOnce(createdUser);
    await handler.execute(command);
    expect(prismaUserCreateMock).toBeCalledWith({ data: { ...command } });
    expect(eventBusPublishMock).toBeCalledWith(new UserCreatedEvent(createdUser));
  });
});
