import { reqUser } from './req-user.decorator';

const req = jest.fn();
const context = {
  switchToHttp: () => ({
    getRequest: req,
  }),
} as any;

describe(reqUser.name, () => {
  it('returns user from req.user', () => {
    const user = {};
    req.mockReturnValueOnce({ user });
    expect(reqUser(null, context)).toBe(user);
  });

  it('returns null if !req.user', () => {
    req.mockReturnValueOnce({ user: undefined });
    expect(reqUser(null, context)).toBeNull();
  });
});
