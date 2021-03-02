import { userIdInner } from './userId.decorator';

const userId = '123';
const getRequestMock = jest.fn().mockImplementation(() => ({
  userId,
}));
const executionContextMock = {
  switchToHttp: () => {
    return {
      getRequest: getRequestMock,
    };
  },
};

describe('CurrentUser', () => {
  it('should return user', () => {
    expect(userIdInner(null, executionContextMock as any)).toBe(userId);
  });

  it('should return undefined if user not found', () => {
    getRequestMock.mockImplementation(() => ({}));
    expect(userIdInner(null, executionContextMock as any)).toBeNull();
  });
});
