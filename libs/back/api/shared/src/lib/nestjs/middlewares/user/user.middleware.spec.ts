// region MUST GO BEFORE IMPORTS
const setUser = jest.fn();
jest.mock('@sentry/node', () => ({ setUser }));
// endregion

import { RequestExtended, UserGetQuery } from '@seed/back/api/shared';
import { UserMiddleware } from './user.middleware';

describe(UserMiddleware.name, () => {
  // region SETUP
  const queryBus = { execute: jest.fn() };
  const getReq = (userId?: string): RequestExtended => ({ userId } as any);
  const res = {} as any;
  const next = jest.fn();
  const userMiddleware = new UserMiddleware(queryBus as any);
  beforeEach(() => {
    queryBus.execute.mockClear();
    next.mockClear();
    setUser.mockClear();
  });
  // endregion

  it('if "!req.userId" - just calls "next()"', async () => {
    const req = getReq();
    queryBus.execute.mockReturnValue(null);
    await userMiddleware.use(req, res, next);
    expect(req.user).toEqual(undefined);
    expect(queryBus.execute).not.toBeCalled();
    expect(setUser).not.toBeCalled();
    expect(next).toBeCalled();
  });

  it('if "req.userId", but !"db.user" - just calls "next()"', async () => {
    const userId = '123';
    const req = getReq(userId);
    queryBus.execute.mockReturnValue(null);
    await userMiddleware.use(req, res, next);
    expect(queryBus.execute).toBeCalledWith(new UserGetQuery(userId));
    expect(req.user).toEqual(undefined);
    expect(setUser).not.toBeCalled();
    expect(next).toBeCalled();
  });

  it('if "req.userId" and "db.user" - saves it to "req.user"', async () => {
    const userId = '123';
    const req = getReq(userId);
    const user = {};
    queryBus.execute.mockReturnValue(user);
    await userMiddleware.use(req, res, next);
    expect(queryBus.execute).toBeCalledWith(new UserGetQuery(userId));
    expect(req.user).toEqual(user);
    expect(setUser).toBeCalledWith(user);
    expect(next).toBeCalled();
  });
});
