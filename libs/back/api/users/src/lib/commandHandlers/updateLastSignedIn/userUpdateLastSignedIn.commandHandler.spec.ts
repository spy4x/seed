import { Test } from '@nestjs/testing';
import {
  EventBusExt,
  PrismaService,
  UserLastSignedInUpdatedEvent,
  UserUpdateLastSignedInCommand,
} from '@seed/back/api/shared';
import { UserUpdateLastSignedInCommandHandler } from './userUpdateLastSignedIn.commandHandler';
import { mockUsers } from '@seed/shared/mock-data';

describe('UserUpdateCommandHandler', () => {
  //region VARIABLES
  const [user] = mockUsers;
  const updateMock = jest.fn();
  const prismaServiceMock = jest.fn().mockImplementation(() => ({
    user: {
      update: updateMock,
    },
  }));
  const eventBusPublishMock = jest.fn();
  const eventBusMock = jest.fn().mockImplementation(() => ({
    publish: eventBusPublishMock,
  }));
  let handler: UserUpdateLastSignedInCommandHandler;
  //endregion

  //region SETUP
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        UserUpdateLastSignedInCommandHandler,
        { provide: PrismaService, useClass: prismaServiceMock },
        { provide: EventBusExt, useClass: eventBusMock },
      ],
    }).compile();
    handler = moduleRef.get(UserUpdateLastSignedInCommandHandler);
  });
  //endregion

  it('should update user.lastTimeSignedIn in DB, publish UserLastSignedInUpdatedEvent, and return updatedUser', async () => {
    const mockDate = new Date();
    jest.useFakeTimers({
      now: mockDate,
    });
    const updatedUser = user;
    updateMock.mockReturnValueOnce(updatedUser);
    expect(await handler.execute(new UserUpdateLastSignedInCommand(user.id))).toEqual(updatedUser);
    expect(updateMock).toBeCalledWith({
      where: {
        id: user.id,
      },
      data: {
        lastTimeSignedIn: mockDate,
      },
    });
    expect(eventBusPublishMock).toBeCalledWith(new UserLastSignedInUpdatedEvent(updatedUser));
  });
});
