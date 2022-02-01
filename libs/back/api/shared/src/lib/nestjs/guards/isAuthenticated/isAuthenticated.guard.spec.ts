import { IsAuthenticatedGuard } from './isAuthenticated.guard';

describe(IsAuthenticatedGuard.name, () => {
  // region SETUP
  const isAuthenticatedGuard = new IsAuthenticatedGuard();
  const getReq = jest.fn();
  const context = {
    switchToHttp: () => ({
      getRequest: getReq,
    }),
  } as any;
  beforeEach(() => getReq.mockClear());
  // endregion

  it('throws UnauthorizedException if req.userId is null', () => {
    getReq.mockReturnValue({ userId: undefined });
    expect(isAuthenticatedGuard.canActivate(context)).toBe(false);
  });

  it('returns true if req.userId is defined', () => {
    getReq.mockReturnValue({ userId: '123' });
    expect(isAuthenticatedGuard.canActivate(context)).toBe(true);
  });
});
