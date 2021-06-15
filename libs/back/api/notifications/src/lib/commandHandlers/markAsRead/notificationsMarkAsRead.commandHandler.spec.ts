import { Test } from '@nestjs/testing';
import { NotificationsMarkAsReadCommand, PrismaService } from '@seed/back/api/shared';
import { NotificationsMarkAsReadCommandHandler } from './notificationsMarkAsRead.commandHandler';
import { mockNotifications } from '@seed/shared/mock-data';
import { ZERO } from '@seed/shared/constants';
import { Prisma } from '@prisma/client';

describe('NotificationsMarkAsReadCommandHandler', () => {
  const updateManyMock = jest.fn();
  const prismaServiceMock = jest.fn().mockImplementation(() => ({
    notification: {
      updateMany: updateManyMock,
    },
  }));
  let notificationsMarkAsReadCommandHandler: NotificationsMarkAsReadCommandHandler;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [NotificationsMarkAsReadCommandHandler, { provide: PrismaService, useClass: prismaServiceMock }],
    }).compile();

    notificationsMarkAsReadCommandHandler = moduleRef.get(NotificationsMarkAsReadCommandHandler);
    updateManyMock.mockClear();
  });

  function mockUpdate(command: NotificationsMarkAsReadCommand): Prisma.BatchPayload {
    const updatedRowsNumber = mockNotifications.filter(n => n.userId === command.currentUserId).length;
    const result = { count: updatedRowsNumber };
    updateManyMock.mockReturnValueOnce(result);
    return result;
  }

  describe('execute', () => {
    it('should updateMany notifications where userId = command.currentUserId and id in ids, when ids.length > 0, and return updated count', async () => {
      const command = new NotificationsMarkAsReadCommand(
        mockNotifications[ZERO].userId,
        mockNotifications.map(n => n.id),
      );
      const updatedRowsNumber = mockUpdate(command);
      expect(await notificationsMarkAsReadCommandHandler.execute(command)).toEqual(updatedRowsNumber);
      expect(updateManyMock).toBeCalledWith({
        where: {
          id: {
            in: command.ids,
          },
          userId: command.currentUserId,
          isRead: false,
        },
        data: { isRead: true },
      });
    });
    it('should updateMany notifications where userId = command.currentUserId, when ids.length === 0, and return updated count', async () => {
      const command = new NotificationsMarkAsReadCommand(mockNotifications[ZERO].userId, []);
      const updatedRowsNumber = mockUpdate(command);
      expect(await notificationsMarkAsReadCommandHandler.execute(command)).toEqual(updatedRowsNumber);
      expect(updateManyMock).toBeCalledWith({
        where: {
          userId: command.currentUserId,
          isRead: false,
        },
        data: { isRead: true },
      });
    });
    it('should updateMany notifications where userId = command.currentUserId, when ids === undefined, and return updated count', async () => {
      const command = new NotificationsMarkAsReadCommand(mockNotifications[ZERO].userId, undefined);
      const updatedRowsNumber = mockUpdate(command);
      expect(await notificationsMarkAsReadCommandHandler.execute(command)).toEqual(updatedRowsNumber);
      expect(updateManyMock).toBeCalledWith({
        where: {
          userId: command.currentUserId,
          isRead: false,
        },
        data: { isRead: true },
      });
    });
  });
});
