import { Test } from '@nestjs/testing';
import { PaginationResponseDTO, PrismaService, UserDevicesFindMyQuery } from '@seed/back/api/shared';
import { UserDevicesFindMyQueryHandler } from './userDevicesFindMy.queryHandler';
import { mockUserDevices } from '@seed/shared/mock-data';
import { UserDevice } from '@prisma/client';

describe(UserDevicesFindMyQueryHandler.name, () => {
  //region VARIABLES
  let handler: UserDevicesFindMyQueryHandler;
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
  //endregion

  //region SETUP
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        UserDevicesFindMyQueryHandler,
        {
          provide: PrismaService,
          useClass: prismaServiceMock,
        },
      ],
    }).compile();
    handler = moduleRef.get(UserDevicesFindMyQueryHandler);
  });
  beforeEach(() => {
    findManyMock.mockClear();
    countMock.mockClear();
    transactionMock.mockClear();
  });
  function getQuery(pageArg?: number, limitArg?: number): UserDevicesFindMyQuery {
    return new UserDevicesFindMyQuery('123', pageArg, limitArg);
  }
  //endregion

  it('should call prisma.userDevice.findMany(), prisma.userDevice.count(), prisma.$transaction() with basic params', async () => {
    const query = getQuery(page, limit);
    const result = await handler.execute(query);
    const where = {
      userId: query.currentUserId,
    };

    expect(findManyMock).toBeCalledWith({
      where,
      ...handler.getPrismaTakeAndSkip(query),
    });
    expect(countMock).toHaveBeenCalledWith({ where });
    expect(transactionMock).toHaveBeenCalledWith([findManyMockResult, countMockResult]);
    expect(result).toEqual(new PaginationResponseDTO<UserDevice>(findManyMockResult, page, limit, countMockResult));
  });
});
