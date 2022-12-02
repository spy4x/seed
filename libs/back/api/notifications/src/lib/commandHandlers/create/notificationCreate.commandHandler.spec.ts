import { Test } from '@nestjs/testing';
import { EventBusExt, NotificationCreateCommand, NotificationCreatedEvent, PrismaService } from '@seed/back/api/shared';
import { NotificationCreateCommandHandler } from './notificationCreate.commandHandler';
import { mockNotifications } from '@seed/shared/mock-data';
import { Notification } from '@prisma/client';

describe(NotificationCreateCommandHandler.name, () => {
  // region VARIABLES
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
  let handler: NotificationCreateCommandHandler;
  const [notification] = mockNotifications;
  const command = new NotificationCreateCommand(notification.userId, notification.type);
  // endregion

  // region SETUP
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationCreateCommandHandler,
        { provide: PrismaService, useClass: prismaServiceMock },
        { provide: EventBusExt, useClass: eventBusMock },
      ],
    }).compile();

    handler = moduleRef.get(NotificationCreateCommandHandler);
  });
  // endregion

  it('should create Notification, publish event about it, and return created Notification', async () => {
    const now = new Date();
    const createdNotification: Notification = {
      id: '123',
      ...command,
      isRead: false,
      createdAt: now,
      updatedAt: now,
    };
    createMock.mockReturnValueOnce(createdNotification);
    expect(await handler.execute(command)).toStrictEqual(createdNotification);
    expect(createMock).toBeCalledWith({ data: command });
    expect(eventBusPublishMock).toBeCalledWith(new NotificationCreatedEvent(createdNotification));
  });
});
