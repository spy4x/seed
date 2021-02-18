import { UserMiddleware } from './user.middleware';

describe('UserMiddleware', () => {
  const getFirebaseServiceMock = (result: null | string) => ({
    validateJWT: jest.fn().mockImplementation(() => Promise.resolve(result)),
  });
  const getRequestMock = (token: null | string) =>
    new (jest.fn().mockImplementation(() => ({ headers: { authorization: token } })))();
  const nextMock = new (jest.fn().mockImplementation(() => () => null))();
  const responseMock = new (jest.fn())();

  it('should add user to request object when token is provided', async () => {
    const req = getRequestMock('token1');
    const resultUserId = 'user1';
    const firebaseService = getFirebaseServiceMock(resultUserId) as any;
    await new UserMiddleware(firebaseService).use(req, responseMock, nextMock);
    expect(req.userId).toEqual(resultUserId);
  });
  it('should call firebaseService.validateJWT with request token', async () => {
    const token = 'token1';
    const firebaseService = getFirebaseServiceMock('user1') as any;
    await new UserMiddleware(firebaseService).use(getRequestMock(token), responseMock, nextMock);
    expect(firebaseService.validateJWT).toBeCalledTimes(1);
    expect(firebaseService.validateJWT).toBeCalledWith(token);
  });
  it('should not add user to request object when token not provided', async () => {
    const req = getRequestMock(null);
    const firebaseService = getFirebaseServiceMock(null) as any;
    await new UserMiddleware(firebaseService).use(req, responseMock, nextMock);
    expect(req.userId).toBeUndefined();
  });
});
