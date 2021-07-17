import { AUTH_FEATURE_KEY, AuthPartialState, initialState, State } from './auth.reducer';
import * as AuthSelectors from './auth.selectors';
import { AuthProvider, AuthStage } from '@seed/front/shared/types';
import { testDisplayName, testEmail, testPhotoURL, testUserId } from '@seed/shared/mock-data';

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
      setState({ stage: AuthStage.signingGoogle });
      expect(AuthSelectors.getStage(state)).toBe(AuthStage.signingGoogle);
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

  describe('getEmail()', () => {
    it('returns state.auth.email undefined', () => {
      setState({ email: undefined });
      expect(AuthSelectors.getEmail(state)).toBe(undefined);
    });
    it('returns state.auth.email value', () => {
      setState({ email: testEmail });
      expect(AuthSelectors.getEmail(state)).toBe(testEmail);
    });
  });

  describe('getDisplayName()', () => {
    it('returns state.auth.displayName undefined', () => {
      setState({ displayName: undefined });
      expect(AuthSelectors.getDisplayName(state)).toBe(undefined);
    });
    it('returns state.auth.displayName value', () => {
      setState({ displayName: testDisplayName });
      expect(AuthSelectors.getDisplayName(state)).toBe(testDisplayName);
    });
  });

  describe('getPhotoURL()', () => {
    it('returns state.auth.photoURL undefined', () => {
      setState({ photoURL: undefined });
      expect(AuthSelectors.getPhotoURL(state)).toBe(undefined);
    });
    it('returns state.auth.photoURL value', () => {
      setState({ photoURL: testPhotoURL });
      expect(AuthSelectors.getPhotoURL(state)).toBe(testPhotoURL);
    });
  });

  describe('getIsNewUser()', () => {
    it(`returns undefined if (isNewUser && providers) === undefined`, () => {
      setState({ isNewUser: undefined, providers: undefined });
      expect(AuthSelectors.getIsNewUser(state)).toBe(undefined);
    });
    it(`returns true if isNewUser === true`, () => {
      setState({ isNewUser: true });
      expect(AuthSelectors.getIsNewUser(state)).toBe(true);
    });
    it(`returns false if isNewUser === isNewUser`, () => {
      setState({ isNewUser: false });
      expect(AuthSelectors.getIsNewUser(state)).toBe(false);
    });
    it(`returns true if providers.length > 0`, () => {
      setState({ isNewUser: undefined, providers: [AuthProvider.google] });
      expect(AuthSelectors.getIsNewUser(state)).toBe(true);
    });
    it(`returns false if state.auth.providers.length === 0`, () => {
      setState({ isNewUser: undefined, providers: [] });
      expect(AuthSelectors.getIsNewUser(state)).toBe(false);
    });
  });

  describe('getIsAuthenticated()', () => {
    it(`returns true if state.auth.stage === ${AuthStage.authenticated}`, () => {
      setState({ stage: AuthStage.authenticated });
      expect(AuthSelectors.getIsAuthenticated(state)).toBe(true);
    });
    it(`returns false if state.auth.stage !== ${AuthStage.authenticated}`, () => {
      setState({ stage: AuthStage.signingEmailAndPassword });
      expect(AuthSelectors.getIsAuthenticated(state)).toBe(false);
    });
  });

  describe('getUserId()', () => {
    it('returns userId if state.auth.userId is set', () => {
      setState({ userId: testUserId });
      expect(AuthSelectors.getUserId(state)).toBe(testUserId);
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
