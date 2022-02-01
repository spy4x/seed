import { reqUserId } from './req-user-id.decorator';

const req = jest.fn();
const context = {
  switchToHttp: () => ({
    getRequest: req,
  }),
} as any;

describe(reqUserId.name, () => {
  it('returns user from req.userId', () => {
    const userId = '123';
    req.mockReturnValueOnce({ userId });
    expect(reqUserId(null, context)).toBe(userId);
  });

  it('returns null if !req.userId', () => {
    req.mockReturnValueOnce({ userId: undefined });
    expect(reqUserId(null, context)).toBeNull();
  });
});
