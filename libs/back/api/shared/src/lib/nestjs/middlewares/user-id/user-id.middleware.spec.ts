// region MUST GO BEFORE IMPORTS
const setUser = jest.fn();
jest.mock('@sentry/node', () => ({ setUser }));
// endregion

import { RequestExtended } from '../../baseClasses';
import { UserIdMiddleware } from './user-id.middleware';

describe(UserIdMiddleware.name, () => {
  // region SETUP
  const firebaseAuth = { validateJWT: jest.fn() };
  const getReq = (token?: string): RequestExtended => ({ headers: { authorization: token } } as any);
  const res = {} as any;
  const next = jest.fn();
  const userMiddleware = new UserIdMiddleware(firebaseAuth as any);
  beforeEach(() => {
    firebaseAuth.validateJWT.mockClear();
    next.mockClear();
  });
  // endregion

  it('if jwt is not provided - doesnt validate it and doesnt add userid to req', async () => {
    const req = getReq();
    await userMiddleware.use(req, res, next);
    expect(firebaseAuth.validateJWT).not.toBeCalled();
    expect(req.userId).toBeUndefined();
    expect(setUser).toHaveBeenCalledWith(null);
    expect(next).toBeCalled();
  });

  it('validates jwt, and if valid - adds userId to req', async () => {
    const token = 'token1';
    const req = getReq(token);
    const resultUserId = 'user1';
    firebaseAuth.validateJWT.mockReturnValueOnce(resultUserId);
    await userMiddleware.use(req, res, next);
    expect(req.userId).toEqual(resultUserId);
    expect(setUser).toHaveBeenCalledWith({ id: resultUserId });
    expect(next).toBeCalled();
  });

  it(`validates jwt and if not valid - doesn't add userid to req`, async () => {
    const token = 'token1';
    firebaseAuth.validateJWT.mockReturnValueOnce(null);
    const req = getReq(token);
    await userMiddleware.use(req, res, next);
    expect(firebaseAuth.validateJWT).toBeCalledWith(token);
    expect(req.userId).toBeUndefined();
    expect(setUser).toHaveBeenCalledWith(null);
    expect(next).toBeCalled();
  });
});
