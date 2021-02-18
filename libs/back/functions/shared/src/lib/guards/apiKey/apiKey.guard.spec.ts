// import { ApiKeyGuard } from './apiKey.guard';

describe('ApiKeyGuard', () => {
  // const apiOwnerGuard = new ApiKeyGuard({} as any, {} as any);
  // const getContextMock = (requestUserId: null | string, paramsUserId: null | string) =>
  //   jest.fn().mockImplementation(() => ({
  //     switchToHttp: () => ({
  //       getRequest: () => ({ userId: requestUserId, params: { userId: paramsUserId } }),
  //     }),
  //   }));

  it.todo(
    'should return true when API Key equals the one from config' /*, async () => {
    const context = new (getContextMock('aaa', 'aaa'))();
    expect(await apiOwnerGuard.canActivate(context)).toBe(true);
  }*/,
  );

  it.todo(
    'should return false when API Key does not equal the one from config' /*, async () => {
    const context = new (getContextMock('aaa', 'aaa'))();
    expect(await apiOwnerGuard.canActivate(context)).toBe(false);
  }*/,
  );

  it.todo(
    'should return false when API Key is not provided' /*, async () => {
    const context = new (getContextMock('aaa', 'aaa'))();
    expect(await apiOwnerGuard.canActivate(context)).toBe(false);
  }*/,
  );
});
