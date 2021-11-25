import { DoesUserExistGuard } from './doesUserExist.guard';
import { ForbiddenException } from '@nestjs/common';

describe(DoesUserExistGuard.name, () => {
  // region SETUP
  const guard = new DoesUserExistGuard();
  const getReq = jest.fn();
  const context = {
    switchToHttp: () => ({
      getRequest: getReq,
    }),
  } as any;
  beforeEach(() => getReq.mockClear());
  // endregion

  it('throws error if no req.user', async () => {
    getReq.mockReturnValueOnce({});
    expect(() => guard.canActivate(context)).toThrow(
      new ForbiddenException("User doesn't exist in DB. Create user first"),
    );
  });

  it('returns true if req.user', async () => {
    getReq.mockReturnValueOnce({ user: {} });
    expect(guard.canActivate(context)).toBe(true);
  });
});
