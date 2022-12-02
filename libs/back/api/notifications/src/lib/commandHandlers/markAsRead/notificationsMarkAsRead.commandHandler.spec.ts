import { Test } from '@nestjs/testing';
import { NotificationsMarkAsReadCommand, PrismaService } from '@seed/back/api/shared';
import { NotificationsMarkAsReadCommandHandler } from './notificationsMarkAsRead.commandHandler';
import { mockNotifications } from '@seed/shared/mock-data';
import { ZERO } from '@seed/shared/constants';
import { Prisma } from '@prisma/client';

describe(NotificationsMarkAsReadCommandHandler.name, () => {
  // region VARIABLES
  const updateManyMock = jest.fn();
  const prismaServiceMock = jest.fn().mockImplementation(() => ({
    notification: {
      updateMany: updateManyMock,
    },
  }));
  let handler: NotificationsMarkAsReadCommandHandler;
  // endregion

  //region SETUP
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [NotificationsMarkAsReadCommandHandler, { provide: PrismaService, useClass: prismaServiceMock }],
    }).compile();
    handler = moduleRef.get(NotificationsMarkAsReadCommandHandler);
  });
  beforeEach(() => {
    updateManyMock.mockClear();
  });
  function mockUpdate(command: NotificationsMarkAsReadCommand): Prisma.BatchPayload {
    const updatedRowsNumber = mockNotifications.filter(n => n.userId === command.currentUserId).length;
    const result = { count: updatedRowsNumber };
    updateManyMock.mockReturnValueOnce(result);
    return result;
  }
  function runTest(options: { testName: string; userId: string; notificationsIds?: string[] }): void {
    it(options.testName, async () => {
      const command = new NotificationsMarkAsReadCommand(options.userId, options.notificationsIds);
      const updatedRowsNumber = mockUpdate(command);
      expect(await handler.execute(command)).toEqual(updatedRowsNumber);
      const idsIn =
        options.notificationsIds && options.notificationsIds.length
          ? {
              id: {
                in: options.notificationsIds,
              },
            }
          : {};
      expect(updateManyMock).toBeCalledWith({
        where: {
          ...idsIn,
          userId: command.currentUserId,
          isRead: false,
        },
        data: { isRead: true },
      });
    });
  }
  //endregion

  runTest({
    testName:
      'should mark notifications as read where userId = command.currentUserId and id in ids, and return updated count',
    userId: mockNotifications[ZERO].userId,
    notificationsIds: mockNotifications.map(n => n.id),
  });

  runTest({
    testName:
      'should mark all notifications as read where userId = command.currentUserId, when ids.length === 0, and return updated count',
    userId: mockNotifications[ZERO].userId,
    notificationsIds: [],
  });

  runTest({
    testName:
      'should mark all notifications as read where userId = command.currentUserId, when ids === undefined, and return updated count',
    userId: mockNotifications[ZERO].userId,
    notificationsIds: undefined,
  });
});
