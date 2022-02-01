import { API_KEY_QUERY_SEGMENT_NAME, ApiKeyGuard } from './apiKey.guard';

describe(ApiKeyGuard.name, () => {
  // region SETUP
  const reflector = { get: jest.fn() };
  const guard = new ApiKeyGuard(reflector as any);
  const getReq = jest.fn();
  const context = {
    switchToHttp: () => ({
      getRequest: getReq,
    }),
    getHandler: jest.fn(),
  } as any;
  beforeEach(() => {
    getReq.mockReset();
    reflector.get.mockReset();
  });
  // endregion
  it('returns false when API Key is not provided', () => {
    getReq.mockReturnValue({ query: {} });
    expect(guard.canActivate(context)).toBe(false);
  });

  it('returns false when provided API Key does not equal true value', () => {
    const providedValue = 'fake value';
    const trueValue = 'true value';
    getReq.mockReturnValue({ query: { [API_KEY_QUERY_SEGMENT_NAME]: providedValue } });
    reflector.get.mockReturnValue(trueValue);
    expect(guard.canActivate(context)).toBe(false);
  });

  it('returns true when provided API Key equals true value', () => {
    const trueValue = 'true value';
    getReq.mockReturnValue({ query: { [API_KEY_QUERY_SEGMENT_NAME]: trueValue } });
    reflector.get.mockReturnValue(trueValue);
    expect(guard.canActivate(context)).toBe(true);
  });
});
