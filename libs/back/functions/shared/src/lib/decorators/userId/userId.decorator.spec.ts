import { UserIdInner } from './userId.decorator';

const userId = '123';
const getRequestMock = jest.fn().mockImplementation(() => ({
  userId,
}));
const ExecutionContextMock = jest.fn().mockImplementation(() => ({
  switchToHttp: () => {
    return {
      getRequest: getRequestMock,
    };
  },
}));

describe('CurrentUser', () => {
  it('should return user', () => {
    const result = UserIdInner(null, new ExecutionContextMock());
    console.log({ result: result });
    expect(result).toBe(userId);
  });

  it('should return undefined if user not found', () => {
    getRequestMock.mockImplementation(() => ({}));
    const result = UserIdInner(null, new ExecutionContextMock());
    expect(result).toBeUndefined();
  });
});
