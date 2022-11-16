import { AUTH_FEATURE_KEY, AuthPartialState, initialState, State } from './auth.reducer';
import * as AuthSelectors from './auth.selectors';
import { AuthProvider, AuthStage } from '@seed/front/shared/types';
import { mockUsers, testDisplayName, testEmail, testPhotoURL, testUserId } from '@seed/shared/mock-data';

describe('Auth Selectors', () => {
  let state: AuthPartialState;
  const [testUser] = mockUsers;

  beforeEach(() => (state = { [AUTH_FEATURE_KEY]: initialState }));

  function patchState(partialNewState: Partial<State>): void {
    state = { [AUTH_FEATURE_KEY]: { ...state[AUTH_FEATURE_KEY], ...partialNewState } };
  }

  describe('getAuthState()', () => {
    it('returns AuthState', () => {
      expect(AuthSelectors.getAuthState(state)).toBe(state[AUTH_FEATURE_KEY]);
    });
  });

  describe('getStage()', () => {
    it('returns state.auth.stage', () => {
      patchState({ stage: AuthStage.signingGoogle });
      expect(AuthSelectors.getStage(state)).toBe(AuthStage.signingGoogle);
    });
    it('returns state.auth.stage', () => {
      patchState({ stage: AuthStage.restoringPassword });
      expect(AuthSelectors.getStage(state)).toBe(AuthStage.restoringPassword);
    });
  });

  describe('getInProgress()', () => {
    it('returns state.auth.inProgress true', () => {
      patchState({ inProgress: true });
      expect(AuthSelectors.getInProgress(state)).toBe(true);
    });
    it('returns state.auth.inProgress false', () => {
      patchState({ inProgress: false });
      expect(AuthSelectors.getInProgress(state)).toBe(false);
    });
  });

  describe('getOriginalUrl()', () => {
    it('returns state.auth.originalURL', () => {
      const originalURL = '/my-url';
      patchState({ originalURL });
      expect(AuthSelectors.getOriginalUrl(state)).toBe(originalURL);
    });
  });

  describe('getEmail()', () => {
    it('returns state.auth.email undefined', () => {
      patchState({ email: undefined });
      expect(AuthSelectors.getEmail(state)).toBe(undefined);
    });
    it('returns state.auth.email value', () => {
      patchState({ email: testEmail });
      expect(AuthSelectors.getEmail(state)).toBe(testEmail);
    });
  });

  describe('getDisplayName()', () => {
    it('returns state.auth.displayName undefined', () => {
      patchState({ displayName: undefined });
      expect(AuthSelectors.getDisplayName(state)).toBe(undefined);
    });
    it('returns state.auth.displayName value', () => {
      patchState({ displayName: testDisplayName });
      expect(AuthSelectors.getDisplayName(state)).toBe(testDisplayName);
    });
  });

  describe('getPhotoURL()', () => {
    it('returns state.auth.photoURL undefined', () => {
      patchState({ photoURL: undefined });
      expect(AuthSelectors.getPhotoURL(state)).toBe(undefined);
    });
    it('returns state.auth.photoURL value', () => {
      patchState({ photoURL: testPhotoURL });
      expect(AuthSelectors.getPhotoURL(state)).toBe(testPhotoURL);
    });
  });

  describe('getIsNewUser()', () => {
    it(`returns undefined if (isNewUser && providers) === undefined`, () => {
      patchState({ isNewUser: undefined, providers: undefined });
      expect(AuthSelectors.getIsNewUser(state)).toBe(undefined);
    });
    it(`returns true if isNewUser === true`, () => {
      patchState({ isNewUser: true });
      expect(AuthSelectors.getIsNewUser(state)).toBe(true);
    });
    it(`returns false if isNewUser === isNewUser`, () => {
      patchState({ isNewUser: false });
      expect(AuthSelectors.getIsNewUser(state)).toBe(false);
    });
    it(`returns false if providers.length > 0`, () => {
      patchState({ isNewUser: undefined, providers: [AuthProvider.google] });
      expect(AuthSelectors.getIsNewUser(state)).toBe(false);
    });
    it(`returns true if state.auth.providers.length === 0`, () => {
      patchState({ isNewUser: undefined, providers: [] });
      expect(AuthSelectors.getIsNewUser(state)).toBe(true);
    });
  });

  describe('getEmailPasswordPayload()', () => {
    it(`returns {email: '', isNewUser: false} if both email & isNewUser are undefined`, () => {
      patchState({ email: undefined, isNewUser: undefined });
      expect(AuthSelectors.getEmailPasswordPayload(state)).toEqual({ email: '', isNewUser: false });
    });
    it(`returns {email: value, isNewUser: false} if email is set, but isNewUser is undefined`, () => {
      patchState({ email: testEmail, isNewUser: undefined });
      expect(AuthSelectors.getEmailPasswordPayload(state)).toEqual({ email: testEmail, isNewUser: false });
    });
    it(`returns {email: value, isNewUser: false} if email is set & isNewUser is false`, () => {
      patchState({ email: testEmail, isNewUser: false });
      expect(AuthSelectors.getEmailPasswordPayload(state)).toEqual({ email: testEmail, isNewUser: false });
    });
    it(`returns {email: value, isNewUser: true} if email is set & isNewUser is true`, () => {
      patchState({ email: testEmail, isNewUser: true });
      expect(AuthSelectors.getEmailPasswordPayload(state)).toEqual({ email: testEmail, isNewUser: true });
    });
  });

  describe('getUserId()', () => {
    it('returns userId if state.auth.userId is set', () => {
      patchState({ userId: testUserId });
      expect(AuthSelectors.getUserId(state)).toBe(testUserId);
    });
    it('returns undefined if state.auth.userId is not set', () => {
      patchState({ userId: undefined });
      expect(AuthSelectors.getUserId(state)).toBe(undefined);
    });
  });

  describe('getUser()', () => {
    it('returns user if state.auth.user is set', () => {
      patchState({ user: testUser });
      expect(AuthSelectors.getUser(state)).toBe(testUser);
    });
    it('returns undefined if state.auth.userId is not set', () => {
      patchState({ userId: undefined });
      expect(AuthSelectors.getUserId(state)).toBe(undefined);
    });
  });

  describe('getErrorMessage()', () => {
    it('returns errorMessage if state.auth.errorMessage is set', () => {
      const errorMessage = 'Wrong password';
      patchState({ error: { message: errorMessage } });
      expect(AuthSelectors.getErrorMessage(state)).toBe(errorMessage);
    });
    it('returns undefined if state.auth.errorMessage is not set', () => {
      patchState({ error: undefined });
      expect(AuthSelectors.getErrorMessage(state)).toBe(undefined);
    });
  });

  describe('getSuccessMessage()', () => {
    it('returns successMessage if state.auth.successMessage is set', () => {
      const successMessage = 'Password reset!';
      patchState({ successMessage });
      expect(AuthSelectors.getSuccessMessage(state)).toBe(successMessage);
    });
    it('returns undefined if state.auth.successMessage is not set', () => {
      patchState({ successMessage: undefined });
      expect(AuthSelectors.getSuccessMessage(state)).toBe(undefined);
    });
  });

  describe('getJWT()', () => {
    it('returns string if state.auth.jwt is set', () => {
      const jwt = 'jwt';
      patchState({ jwt });
      expect(AuthSelectors.getJWT(state)).toBe(jwt);
    });
    it('returns undefined if state.auth.jwt is not set', () => {
      patchState({ jwt: undefined });
      expect(AuthSelectors.getJWT(state)).toBe(undefined);
    });
  });

  describe('getIsAuthorized()', () => {
    it('returns true if state.auth.stage is AuthStage.authorized', () => {
      const stage = AuthStage.authorized;
      patchState({ stage });
      expect(AuthSelectors.getIsAuthorized(state)).toBe(true);
    });
    it('returns true if state.auth.stage is not AuthStage.authorized', () => {
      const stage = AuthStage.authorizing;
      patchState({ stage });
      expect(AuthSelectors.getIsAuthorized(state)).toBe(false);
    });
  });
});
