import { Test } from '@nestjs/testing';
import { CommandBusExt, UserCreatedEvent } from '@seed/back/api/shared';
import { UserCreatedEventHandler } from './userCreated.eventHandler';
import { mockUsers } from '@seed/shared/mock-data';

describe('UserCreatedEventHandler', () => {
  // region VARIABLES
  const commandBusExecuteMock = jest.fn();
  const commandBusMock = jest.fn().mockImplementation(() => ({
    execute: commandBusExecuteMock,
  }));
  let userCreatedEventHandler: UserCreatedEventHandler;
  const [user] = mockUsers;
  // const userId = user.id;
  const event = new UserCreatedEvent(user);
  // endregion

  // region SETUP
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [UserCreatedEventHandler, { provide: CommandBusExt, useClass: commandBusMock }],
    }).compile();

    userCreatedEventHandler = moduleRef.get(UserCreatedEventHandler);
  });
  // endregion

  it(`should execute command`, () => {
    const mockDate = new Date();
    jest.useFakeTimers({
      now: mockDate,
    });
    userCreatedEventHandler.handle(event);
    // expect(commandBusExecuteMock).toBeCalledWith(
    //   new CloudTaskCreateCommand(
    //     CloudTasksQueues.welcome,
    //     userId,
    //     `${API_CONFIG.apiURL}/notifications/invoke`,
    //     addHours(mockDate, 6),
    //     {
    //       type: NotificationType.WELCOME,
    //       userId,
    //     },
    //   ),
    // );
  });
});
