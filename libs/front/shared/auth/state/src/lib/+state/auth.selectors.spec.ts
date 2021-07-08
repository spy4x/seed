import { AUTH_FEATURE_KEY, AuthPartialState, initialState, State } from './auth.reducer';
import * as AuthSelectors from './auth.selectors';

describe('Auth Selectors', () => {
  let state: AuthPartialState;

  beforeEach(() => (state = { auth: initialState }));

  function setState(partialNewState: Partial<State>): void {
    state = { [AUTH_FEATURE_KEY]: { ...state[AUTH_FEATURE_KEY], ...partialNewState } };
  }

  describe('getAuthState()', () => {
    it('getAuthState() should return AuthState', () => {
      expect(AuthSelectors.getAuthState(state)).toBe(state[AUTH_FEATURE_KEY]);
    });
  });

  describe('getIsAuthenticating()', () => {
    it('getIsAuthenticating() should return state.auth.isAuthenticating true', () => {
      setState({ isAuthenticating: true });
      expect(AuthSelectors.getIsAuthenticating(state)).toBe(true);
    });
    it('getIsAuthenticating() should return state.auth.isAuthenticating false', () => {
      setState({ isAuthenticating: false });
      expect(AuthSelectors.getIsAuthenticating(state)).toBe(false);
    });
  });

  describe('getIsAuthenticated()', () => {
    it('getIsAuthenticated() should return true if state.auth.userId is set', () => {
      setState({ userId: '123' });
      expect(AuthSelectors.getIsAuthenticated(state)).toBe(true);
    });
    it('getIsAuthenticated() should return false if state.auth.userId is not set', () => {
      setState({ userId: undefined });
      expect(AuthSelectors.getIsAuthenticated(state)).toBe(false);
    });
  });

  describe('getUserId()', () => {
    it('getUserId() should return userId if state.auth.userId is set', () => {
      setState({ userId: '123' });
      expect(AuthSelectors.getUserId(state)).toBe('123');
    });
    it('getUserId() should return userId if state.auth.userId is not set', () => {
      setState({ userId: undefined });
      expect(AuthSelectors.getUserId(state)).toBe(undefined);
    });
  });
});
