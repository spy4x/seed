import { Test } from '@nestjs/testing';
import { PaginationResponseDTO, PrismaService, UserDeviceDTO, UserDevicesFindMyQuery } from '@seed/back/api/shared';
import { UserDevicesFindMyQueryHandler } from './userDevicesFindMy.queryHandler';
import { mockUserDevices } from '@seed/shared/mock-data';

describe('UserDevicesFindMyQueryHandler', () => {
  let getUsersHandler: UserDevicesFindMyQueryHandler;
  const page = 3;
  const limit = 50;
  const findManyMockResult = mockUserDevices;
  const countMockResult = mockUserDevices.length;
  const findManyMock = jest.fn().mockReturnValue(findManyMockResult);
  const countMock = jest.fn().mockReturnValue(countMockResult);
  const transactionMock = jest.fn().mockReturnValue([findManyMockResult, countMockResult]);

  const prismaServiceMock = jest.fn().mockImplementation(() => ({
    userDevice: {
      findMany: findManyMock,
      count: countMock,
    },
    $transaction: transactionMock,
  }));

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        UserDevicesFindMyQueryHandler,
        {
          provide: PrismaService,
          useClass: prismaServiceMock,
        },
      ],
    }).compile();
    getUsersHandler = moduleRef.get(UserDevicesFindMyQueryHandler);
    findManyMock.mockClear();
    countMock.mockClear();
    transactionMock.mockClear();
  });

  function getQuery(pageArg?: number, limitArg?: number): UserDevicesFindMyQuery {
    return new UserDevicesFindMyQuery('123', pageArg, limitArg);
  }

  it('should call prisma.userDevice.findMany(), prisma.userDevice.count(), prisma.$transaction() with basic params', async () => {
    const query = getQuery(page, limit);
    const result = await getUsersHandler.execute(query);

    const where = {
      userId: query.currentUserId,
    };
    expect(findManyMock).toBeCalledWith({
      where,
      ...getUsersHandler.getPrismaTakeAndSkip(query),
    });
    expect(countMock).toHaveBeenCalledWith({ where });
    expect(transactionMock).toHaveBeenCalledWith([findManyMockResult, countMockResult]);

    expect(result).toEqual(new PaginationResponseDTO<UserDeviceDTO>(findManyMockResult, page, limit, countMockResult));
  });
});
