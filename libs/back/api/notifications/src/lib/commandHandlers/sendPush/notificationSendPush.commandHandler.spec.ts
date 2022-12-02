import { sample } from 'lodash-es';

const sendToDeviceMock = jest.fn();
jest.mock('firebase-admin', () => ({
  messaging: () => ({
    sendToDevice: sendToDeviceMock,
  }),
}));

import { Test } from '@nestjs/testing';
import {
  EventBusExt,
  NotificationSendPushCommand,
  NotificationSendPushInvalidTokensEvent,
  PrismaService,
} from '@seed/back/api/shared';
import { mockNotifications } from '@seed/shared/mock-data';
import { FCM_INVALID_TOKENS_ERROR, NotificationSendPushCommandHandler } from './notificationSendPush.commandHandler';

describe(NotificationSendPushCommandHandler.name, () => {
  //region VARIABLES
  const createMock = jest.fn();
  const eventBusPublishMock = jest.fn();
  const prismaServiceMock = jest.fn().mockImplementation(() => ({
    notification: {
      create: createMock,
    },
  }));
  const eventBusMock = jest.fn().mockImplementation(() => ({
    publish: eventBusPublishMock,
  }));
  let handler: NotificationSendPushCommandHandler;
  const [notification] = mockNotifications;
  const fcmTokens = ['1', '2', '3', '4', '5'];
  const command = new NotificationSendPushCommand(notification, 'title', 'body', fcmTokens);
  //endregion

  //region SETUP
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationSendPushCommandHandler,
        { provide: PrismaService, useClass: prismaServiceMock },
        { provide: EventBusExt, useClass: eventBusMock },
      ],
    }).compile();

    handler = moduleRef.get(NotificationSendPushCommandHandler);
  });
  beforeEach(() => {
    sendToDeviceMock.mockReset();
    eventBusPublishMock.mockReset();
  });
  //endregion

  async function runTest(): Promise<void> {
    await handler.execute(command);
    expect(sendToDeviceMock).toBeCalledWith(
      command.fcmTokens,
      {
        notification: {
          title: command.title,
          body: command.body,
        },
        data: {
          ...command.notification,
          isRead: command.notification.isRead ? 'true' : 'false',
          createdAt: command.notification.createdAt.toUTCString(),
          updatedAt: command.notification.updatedAt.toUTCString(),
        },
      },
      {
        mutableContent: true,
      },
    );
  }
  it('should send notification via firebase-admin.messaging', async () => {
    sendToDeviceMock.mockReturnValueOnce({ results: fcmTokens.map(() => ({})) });
    await runTest();
    expect(eventBusPublishMock).not.toBeCalled();
  });

  it('should send notification via firebase-admin.messaging and publish event with tokens that are invalid', async () => {
    const invalidTokens: string[] = [];
    sendToDeviceMock.mockReturnValueOnce({
      results: fcmTokens.map((t, i) => {
        if (i % 2 === 0) {
          invalidTokens.push(t);
          return { error: { code: sample(FCM_INVALID_TOKENS_ERROR) } };
        }
        return { error: undefined };
      }),
    });
    await runTest();
    expect(eventBusPublishMock).toBeCalledWith(new NotificationSendPushInvalidTokensEvent(invalidTokens));
  });
});
