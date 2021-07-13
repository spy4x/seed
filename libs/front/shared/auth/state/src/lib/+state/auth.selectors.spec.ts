import { AUTH_FEATURE_KEY, AuthPartialState, initialState, State } from './auth.reducer';
import * as AuthSelectors from './auth.selectors';
import { AuthMethod } from '@seed/front/shared/types';

describe('Auth Selectors', () => {
  let state: AuthPartialState;

  beforeEach(() => (state = { auth: initialState }));

  function setState(partialNewState: Partial<State>): void {
    state = { [AUTH_FEATURE_KEY]: { ...state[AUTH_FEATURE_KEY], ...partialNewState } };
  }

  describe('getAuthState()', () => {
    it('returns AuthState', () => {
      expect(AuthSelectors.getAuthState(state)).toBe(state[AUTH_FEATURE_KEY]);
    });
  });

  describe('getInProgress()', () => {
    it('returns state.auth.inProgress true', () => {
      setState({ inProgress: true });
      expect(AuthSelectors.getInProgress(state)).toBe(true);
    });
    it('returns state.auth.inProgress false', () => {
      setState({ inProgress: false });
      expect(AuthSelectors.getInProgress(state)).toBe(false);
    });
  });

  describe('getIsAuthenticated()', () => {
    it('returns true if state.auth.userId is set', () => {
      setState({ userId: '123' });
      expect(AuthSelectors.getIsAuthenticated(state)).toBe(true);
    });
    it('returns false if state.auth.userId is not set', () => {
      setState({ userId: undefined });
      expect(AuthSelectors.getIsAuthenticated(state)).toBe(false);
    });
  });

  describe('getUserId()', () => {
    it('returns userId if state.auth.userId is set', () => {
      setState({ userId: '123' });
      expect(AuthSelectors.getUserId(state)).toBe('123');
    });
    it('returns userId if state.auth.userId is not set', () => {
      setState({ userId: undefined });
      expect(AuthSelectors.getUserId(state)).toBe(undefined);
    });
  });

  describe('getMethodInProgress()', () => {
    it('returns methodInProgress if state.auth.methodInProgress is set', () => {
      setState({ methodInProgress: AuthMethod.anonymous });
      expect(AuthSelectors.getMethodInProgress(state)).toBe(AuthMethod.anonymous);
    });
    it('returns undefined if state.auth.userId is not set', () => {
      setState({ methodInProgress: undefined });
      expect(AuthSelectors.getMethodInProgress(state)).toBe(undefined);
    });
  });

  describe('getErrorMessage()', () => {
    it('returns errorMessage if state.auth.errorMessage is set', () => {
      const errorMessage = 'Wrong password';
      setState({ errorMessage });
      expect(AuthSelectors.getErrorMessage(state)).toBe(errorMessage);
    });
    it('returns undefined if state.auth.errorMessage is not set', () => {
      setState({ errorMessage: undefined });
      expect(AuthSelectors.getErrorMessage(state)).toBe(undefined);
    });
  });

  describe('getSuccessMessage()', () => {
    it('returns successMessage if state.auth.successMessage is set', () => {
      const successMessage = 'Password reset!';
      setState({ successMessage });
      expect(AuthSelectors.getSuccessMessage(state)).toBe(successMessage);
    });
    it('returns undefined if state.auth.successMessage is not set', () => {
      setState({ successMessage: undefined });
      expect(AuthSelectors.getSuccessMessage(state)).toBe(undefined);
    });
  });
});
