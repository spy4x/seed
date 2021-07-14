import * as AuthUIActions from './actions/ui.actions';
import * as AuthAPIActions from './actions/api.actions';
import { initialState, reducer, State } from './auth.reducer';
import { testEmail, testPassword } from '@seed/shared/mock-data';
import { AuthMethod, AuthStage } from '@seed/front/shared/types';
import { Action } from '@ngrx/store';

describe('Auth Reducer', () => {
  function reducerTest({
    name,
    prevState,
    action,
    nextState,
  }: {
    name?: string;
    prevState?: Partial<State>;
    action: Action;
    nextState: Partial<State>;
  }): void {
    it(name || action.type, () => {
      const setErrorAndSuccess: Partial<State> = {
        error: prevState?.error || { message: 'error' },
        successMessage: prevState?.successMessage || 'success',
      };
      const prevStateFull = { ...initialState, ...prevState, ...setErrorAndSuccess };
      const nextStateFull = reducer(prevStateFull, action);
      const resetErrorAndSuccess: Partial<State> = {
        error: nextState.error || undefined,
        successMessage: nextState.successMessage || undefined,
      };
      expect(nextStateFull).toEqual({ ...prevStateFull, ...nextState, ...resetErrorAndSuccess });
    });
  }

  reducerTest({
    name: 'should return the previous state in case of unknown action',
    prevState: initialState,
    action: {} as any,
    nextState: initialState,
  });

  describe.only('UI Actions', () => {
    reducerTest({
      action: AuthUIActions.signUpAnonymously(),
      nextState: { inProgress: true, selectedProvider: AuthMethod.anonymous },
    });

    reducerTest({
      action: AuthUIActions.enterEmail({ email: testEmail }),
      nextState: { email: testEmail },
    });

    reducerTest({
      prevState: {
        stage: AuthStage.authenticateWithEmailAndPassword,
        prevUser: { email: testEmail },
        email: testEmail,
        providers: [AuthMethod.password],
        selectedProvider: AuthMethod.password,
      },
      action: AuthUIActions.changeUser(),
      nextState: {
        stage: AuthStage.enterEmail,
        prevUser: undefined,
        email: undefined,
        providers: [],
        selectedProvider: undefined,
      },
    });
  });

  describe('API Actions', () => {
    it('init', () => {
      const result = reducer(initialState, AuthAPIActions.init());
      expect(result.inProgress).toBe(true);
      expect(result.userId).toBe(undefined);
      expect(result.error).toBe(undefined);
      expect(result.successMessage).toBe(undefined);
    });

    it('initAuthenticated', () => {
      const result = reducer(initialState, AuthAPIActions.initAuthenticated({ userId: '123' }));
      expect(result.inProgress).toBe(false);
      expect(result.userId).toBe('123');
      expect(result.error).toBe(undefined);
      expect(result.successMessage).toBe(undefined);
    });

    it('authenticated', () => {
      const result = reducer(initialState, AuthAPIActions.authenticated({ userId: '123' }));
      expect(result.inProgress).toBe(false);
      expect(result.userId).toBe('123');
      expect(result.error).toBe(undefined);
      expect(result.successMessage).toBe(undefined);
    });

    it('signedUp', () => {
      const result = reducer(initialState, AuthAPIActions.signedUp({ userId: '123' }));
      expect(result.inProgress).toBe(false);
      expect(result.userId).toBe('123');
      expect(result.error).toBe(undefined);
      expect(result.successMessage).toBe(undefined);
    });

    it('initNotAuthenticated', () => {
      const result = reducer(initialState, AuthAPIActions.initNotAuthenticated());
      expect(result.inProgress).toBe(false);
      expect(result.userId).toBe(undefined);
      expect(result.error).toBe(undefined);
      expect(result.successMessage).toBe(undefined);
    });

    it('authenticateWithGoogle', () => {
      const result = reducer(initialState, AuthUIActions.authenticateWithGoogle());
      expect(result.inProgress).toBe(true);
      // expect(result.methodInProgress).toBe(AuthMethod.google);
      expect(result.error).toBe(undefined);
      expect(result.successMessage).toBe(undefined);
    });

    it('authenticateWithGitHub', () => {
      const result = reducer(initialState, AuthUIActions.authenticateWithGitHub());
      expect(result.inProgress).toBe(true);
      // expect(result.methodInProgress).toBe(AuthMethod.github);
      expect(result.error).toBe(undefined);
      expect(result.successMessage).toBe(undefined);
    });

    it('signInWithEmailAndPassword', () => {
      const result = reducer(initialState, AuthUIActions.signInWithEmailAndPassword({ password: testPassword }));
      expect(result.inProgress).toBe(true);
      // expect(result.methodInProgress).toBe(AuthMethod.password);
      expect(result.error).toBe(undefined);
      expect(result.successMessage).toBe(undefined);
    });

    it('authenticateWithEmailLink', () => {
      const result = reducer(initialState, AuthUIActions.authenticateWithEmailLink());
      expect(result.inProgress).toBe(true);
      // expect(result.methodInProgress).toBe(AuthMethod.link);
      expect(result.error).toBe(undefined);
      expect(result.successMessage).toBe(undefined);
    });

    it('authenticateWithEmailLinkRequestSent', () => {
      const result = reducer(initialState, AuthAPIActions.authenticateWithEmailLinkRequestSent());
      expect(result.inProgress).toBe(false);
      expect(result.error).toBe(undefined);
      expect(result.successMessage).toBe('Magic link has been sent to your email. Follow it to proceed.');
    });

    it('signUpWithEmailAndPassword', () => {
      const result = reducer(initialState, AuthUIActions.signUpWithEmailAndPassword({ password: testPassword }));
      expect(result.inProgress).toBe(true);
      // expect(result.methodInProgress).toBe(AuthMethod.password);
      expect(result.error).toBe(undefined);
      expect(result.successMessage).toBe(undefined);
    });

    it('actionFailed', () => {
      const errorMessage = 'Wrong password';
      const result = reducer(initialState, AuthAPIActions.actionFailed({ message: errorMessage }));
      expect(result.inProgress).toBe(false);
      expect(result.userId).toBe(undefined);
      expect(result.error).toEqual({ message: errorMessage });
      expect(result.successMessage).toBe(undefined);
    });

    it('restorePassword', () => {
      const result = reducer(initialState, AuthUIActions.restorePassword());
      expect(result.inProgress).toBe(true);
      expect(result.userId).toBe(undefined);
      // expect(result.methodInProgress).toBe(AuthMethod.password);
      expect(result.error).toBe(undefined);
      expect(result.successMessage).toBe(undefined);
    });

    it('restorePasswordRequestSent', () => {
      const result = reducer(initialState, AuthAPIActions.restorePasswordSuccess());
      expect(result.inProgress).toBe(false);
      expect(result.userId).toBe(undefined);
      expect(result.error).toBe(undefined);
      expect(result.successMessage).toBe('Check your email for password reset instructions.');
    });

    it('signOut', () => {
      const state = { ...initialState, userId: '123' };
      expect(reducer(state, AuthUIActions.signOut())).toBe(state);
    });

    it('signedOut', () => {
      const state = { ...initialState, userId: '123' };
      const result = reducer(state, AuthAPIActions.signedOut());
      expect(result.userId).toBe(undefined);
    });
  });
});
