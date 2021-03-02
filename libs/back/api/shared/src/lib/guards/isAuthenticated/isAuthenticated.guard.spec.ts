import { IsAuthenticatedGuard } from './isAuthenticated.guard';

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
  it('should return false if userId is null', () => {
    const isAuthenticatedGuard = new IsAuthenticatedGuard();
    const value = isAuthenticatedGuard.canActivate(new contextMock());
    expect(value).toBeFalsy();
  });
  it('should return true if userId is not null', () => {
    userId = '123';
    const isAuthenticatedGuard = new IsAuthenticatedGuard();
    const value = isAuthenticatedGuard.canActivate(new contextMock());
    expect(value).toBeTruthy();
  });
});
