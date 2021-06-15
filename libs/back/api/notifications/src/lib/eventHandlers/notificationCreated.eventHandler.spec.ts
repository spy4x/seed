import { Test } from '@nestjs/testing';
import {
  CommandBusExt,
  NotificationCreatedEvent,
  NotificationSendPushCommand,
  PaginationResponseDTO,
  QueryBusExt,
  UserDevicesFindMyQuery,
  UserGetQuery,
} from '@seed/back/api/shared';
import { NotificationCreatedEventHandler } from './notificationCreated.eventHandler';
import { mockNotifications, mockUserDevices } from '@seed/shared/mock-data';
import { User, UserDevice } from '@prisma/client';

describe('NotificationCreatedEventHandler', () => {
  // region VARIABLES
  const commandBusExecuteMock = jest.fn();
  const commandBusMock = jest.fn().mockImplementation(() => ({
    execute: commandBusExecuteMock,
  }));
  const queryBusExecuteMock = jest.fn();
  const queryBusMock = jest.fn().mockImplementation(() => ({
    execute: queryBusExecuteMock,
  }));
  let handler: NotificationCreatedEventHandler;
  const [notification] = mockNotifications;
  const event = new NotificationCreatedEvent(notification);
  // endregion

  // region SETUP
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationCreatedEventHandler,
        { provide: QueryBusExt, useClass: queryBusMock },
        { provide: CommandBusExt, useClass: commandBusMock },
      ],
    }).compile();

    handler = moduleRef.get(NotificationCreatedEventHandler);
  });

  beforeEach(() => {
    commandBusExecuteMock.mockReset();
    queryBusExecuteMock.mockReset();
  });

  function runTest(options: {
    testName: string;
    user: null | Partial<User>;
    userDevices: UserDevice[];
    commandCalled: boolean;
  }): void {
    it(options.testName, async () => {
      queryBusExecuteMock.mockImplementation(query => {
        if (query instanceof UserGetQuery) {
          return options.user;
        }
        if (query instanceof UserDevicesFindMyQuery) {
          return new PaginationResponseDTO<UserDevice>(options.userDevices, 1, 20, options.userDevices.length);
        }
        throw new Error('Unknown Query');
      });
      await handler.handle(event);
      let queryBusCalledTimes = 1;
      expect(queryBusExecuteMock).toBeCalledWith(new UserGetQuery(notification.userId));
      if (options.user && options.user.isPushNotificationsEnabled) {
        queryBusCalledTimes++;
        expect(queryBusExecuteMock).toBeCalledWith(new UserDevicesFindMyQuery(notification.userId));
      }
      expect(queryBusExecuteMock).toBeCalledTimes(queryBusCalledTimes);
      if (options.commandCalled) {
        expect(commandBusExecuteMock).toBeCalledWith(
          new NotificationSendPushCommand(
            notification,
            'Welcome to the app 🙂',
            'Feel free to contact us with any question or share your feedback!',
            mockUserDevices.map(ud => ud.fcmToken),
          ),
        );
      } else {
        expect(commandBusExecuteMock).not.toBeCalled();
      }
    });
  }
  // endregion

  runTest({
    testName: `should stop if user doesn't exist`,
    user: null,
    userDevices: [],
    commandCalled: false,
  });

  runTest({
    testName: `should stop if user doesn't want to receive push notifications`,
    user: { isPushNotificationsEnabled: false },
    userDevices: [],
    commandCalled: false,
  });

  runTest({
    testName: `should stop if user doesn't have any userDevices`,
    user: { isPushNotificationsEnabled: true },
    userDevices: [],
    commandCalled: false,
  });

  runTest({
    testName: `should execute NotificationSendPushCommand`,
    user: { isPushNotificationsEnabled: true },
    userDevices: mockUserDevices,
    commandCalled: true,
  });
});
