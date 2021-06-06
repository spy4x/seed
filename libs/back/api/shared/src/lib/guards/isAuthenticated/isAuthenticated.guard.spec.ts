import { IsAuthenticatedGuard } from './isAuthenticated.guard';
import { UnauthorizedException } from '@nestjs/common';

describe('IsAuthenticatedGuard', () => {
  let userId: null | string = null;

  const getRequestMock = jest.fn().mockImplementation(() => ({
    userId,
  }));

  const contextMock = jest.fn().mockImplementation(() => ({
    switchToHttp: () => ({
      getRequest: getRequestMock,
    }),
  }));
  it('should throw UnauthorizedException if userId is null', () => {
    userId = null;
    const isAuthenticatedGuard = new IsAuthenticatedGuard();
    expect(() => isAuthenticatedGuard.canActivate(new contextMock())).toThrow(UnauthorizedException);
  });
  it('should return true if userId is not null', () => {
    userId = '123';
    const isAuthenticatedGuard = new IsAuthenticatedGuard();
    const value = isAuthenticatedGuard.canActivate(new contextMock());
    expect(value).toBeTruthy();
  });
});
