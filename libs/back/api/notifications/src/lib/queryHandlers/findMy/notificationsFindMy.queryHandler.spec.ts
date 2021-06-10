import { Test } from '@nestjs/testing';
import { PaginationResponseDTO, PrismaService, NotificationsFindMyQuery } from '@seed/back/api/shared';
import { NotificationsFindMyQueryHandler } from './notificationsFindMy.queryHandler';
import { mockNotifications } from '@seed/shared/mock-data';
import { Notification } from '@prisma/client';

describe('NotificationsFindMyQueryHandler', () => {
  let getUsersHandler: NotificationsFindMyQueryHandler;
  const page = 3;
  const limit = 50;
  const findManyMockResult = mockNotifications;
  const countMockResult = mockNotifications.length;
  const findManyMock = jest.fn().mockReturnValue(findManyMockResult);
  const countMock = jest.fn().mockReturnValue(countMockResult);
  const transactionMock = jest.fn().mockReturnValue([findManyMockResult, countMockResult]);

  const prismaServiceMock = jest.fn().mockImplementation(() => ({
    notification: {
      findMany: findManyMock,
      count: countMock,
    },
    $transaction: transactionMock,
  }));

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsFindMyQueryHandler,
        {
          provide: PrismaService,
          useClass: prismaServiceMock,
        },
      ],
    }).compile();
    getUsersHandler = moduleRef.get(NotificationsFindMyQueryHandler);
    findManyMock.mockClear();
    countMock.mockClear();
    transactionMock.mockClear();
  });

  function getQuery(pageArg?: number, limitArg?: number): NotificationsFindMyQuery {
    return new NotificationsFindMyQuery('123', pageArg, limitArg);
  }

  it('should call prisma.notification.findMany(), prisma.notification.count(), prisma.$transaction() with basic params', async () => {
    const query = getQuery(page, limit);
    const result = await getUsersHandler.execute(query);

    const where = {
      userId: query.currentUserId,
    };
    expect(findManyMock).toBeCalledWith({
      where,
      orderBy: {
        createdAt: 'desc',
      },
      ...getUsersHandler.getPrismaTakeAndSkip(query),
    });
    expect(countMock).toHaveBeenCalledWith({ where });
    expect(transactionMock).toHaveBeenCalledWith([findManyMockResult, countMockResult]);

    expect(result).toEqual(new PaginationResponseDTO<Notification>(findManyMockResult, page, limit, countMockResult));
  });
});
