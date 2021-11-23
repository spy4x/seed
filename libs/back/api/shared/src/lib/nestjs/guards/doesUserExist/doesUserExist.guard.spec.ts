import { DoesUserExistGuard } from './doesUserExist.guard';
import { Test } from '@nestjs/testing';
import { QueryBus } from '@nestjs/cqrs';
import { ForbiddenException } from '@nestjs/common';

describe('DoesUserExistGuard', () => {
  const user = 'user';

  const getRequestMock = jest.fn().mockImplementation(() => ({
    userId: null,
  }));

  const contextMock = jest.fn().mockImplementation(() => ({
    switchToHttp: () => ({
      getRequest: getRequestMock,
    }),
  }));

  const GetUserByIdQueryMock = jest.fn();

  const queryBusMock = jest.fn(() => ({
    execute: GetUserByIdQueryMock,
  }));

  let doesUserExistGuard: DoesUserExistGuard;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DoesUserExistGuard,
        {
          provide: QueryBus,
          useClass: queryBusMock,
        },
      ],
    }).compile();

    doesUserExistGuard = moduleRef.get(DoesUserExistGuard);
  });

  it('should return false if userId is null', async () => {
    //userId = null;
    const value = await doesUserExistGuard.canActivate(new contextMock());
    expect(value).toBeFalsy();
  });

  it('should throw 403 error if user not found by GetUserByIdQuery', async () => {
    getRequestMock.mockImplementation(() => ({ userId: '123456' }));
    GetUserByIdQueryMock.mockImplementation(() => null);
    await expect(doesUserExistGuard.canActivate(new contextMock())).rejects.toThrow(
      new ForbiddenException("User doesn't exist in DB. Create user first"),
    );
  });

  it('should return true if user found by GetUserByIdQuery', async () => {
    getRequestMock.mockImplementation(() => ({ userId: '123456' }));
    GetUserByIdQueryMock.mockImplementation(() => user);
    const value = await doesUserExistGuard.canActivate(new contextMock());
    expect(value).toBeTruthy();
  });
});
