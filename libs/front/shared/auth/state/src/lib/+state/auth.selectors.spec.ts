import { AUTH_FEATURE_KEY, AuthPartialState, initialState, State } from './auth.reducer';
import * as AuthSelectors from './auth.selectors';
import { AuthStage } from '@seed/front/shared/types';

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

  describe('getStage()', () => {
    it('returns state.auth.stage', () => {
      setState({ stage: AuthStage.authenticatingWithGoogle });
      expect(AuthSelectors.getStage(state)).toBe(AuthStage.authenticatingWithGoogle);
    });
    it('returns state.auth.stage', () => {
      setState({ stage: AuthStage.restoringPassword });
      expect(AuthSelectors.getStage(state)).toBe(AuthStage.restoringPassword);
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
    it(`returns true if state.auth.stage === ${AuthStage.signedIn}`, () => {
      setState({ stage: AuthStage.signedIn });
      expect(AuthSelectors.getIsAuthenticated(state)).toBe(true);
    });
    it(`returns false if state.auth.stage !== ${AuthStage.signedIn}`, () => {
      setState({ stage: AuthStage.authenticatingWithEmailAndPassword });
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

  describe('getErrorMessage()', () => {
    it('returns errorMessage if state.auth.errorMessage is set', () => {
      const errorMessage = 'Wrong password';
      setState({ error: { message: errorMessage } });
      expect(AuthSelectors.getErrorMessage(state)).toBe(errorMessage);
    });
    it('returns undefined if state.auth.errorMessage is not set', () => {
      setState({ error: undefined });
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
