import { API_KEY_QUERY_SEGMENT_NAME, ApiKeyGuard } from './apiKey.guard';

describe(ApiKeyGuard.name, () => {
  // region SETUP
  const reflector = { get: jest.fn() };
  const guard = new ApiKeyGuard(reflector as any);
  const requestMock = {
    query: {},
    header: jest.fn(),
  };
  const context = {
    switchToHttp: () => ({
      getRequest: () => requestMock,
    }),
    getHandler: jest.fn(),
  } as any;
  beforeEach(() => {
    reflector.get.mockReset();
  });
  // endregion

  it('returns false when API Key is not provided in query or header', () => {
    const trueValue = 'true value';
    requestMock.query = {};
    requestMock.header = jest.fn();
    reflector.get.mockReturnValue(trueValue);
    expect(guard.canActivate(context)).toBe(false);
  });

  it('returns false when provided API Key in query does not equal true value', () => {
    const providedValue = 'fake value';
    const trueValue = 'true value';
    requestMock.query = { [API_KEY_QUERY_SEGMENT_NAME]: providedValue };
    requestMock.header = jest.fn();
    reflector.get.mockReturnValue(trueValue);
    expect(guard.canActivate(context)).toBe(false);
  });

  it('returns false when provided API Key in header does not equal true value', () => {
    const providedValue = 'fake value';
    const trueValue = 'true value';
    requestMock.query = {};
    requestMock.header = jest.fn(() => providedValue);
    reflector.get.mockReturnValue(trueValue);
    expect(guard.canActivate(context)).toBe(false);
  });

  it('returns true when provided API Key in query equals true value', () => {
    const trueValue = 'true value';
    requestMock.query = { [API_KEY_QUERY_SEGMENT_NAME]: trueValue };
    requestMock.header = jest.fn();
    reflector.get.mockReturnValue(trueValue);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('returns true when provided API Key in header equals true value', () => {
    const trueValue = 'true value';
    requestMock.query = {};
    requestMock.header = jest.fn(() => trueValue);
    reflector.get.mockReturnValue(trueValue);
    expect(guard.canActivate(context)).toBe(true);
  });
});
