import * as AuthActions from './auth.actions';
import { initialState, reducer } from './auth.reducer';
import { AuthMethods } from '@seed/front/shared/types';
import { testEmail, testPassword } from '@seed/shared/mock-data';

describe('Auth Reducer', () => {
  it('should return the previous state in case of unknown action', () => {
    expect(reducer(initialState, {} as any)).toBe(initialState);
  });

  it('init', () => {
    const result = reducer(initialState, AuthActions.init());
    expect(result.isAuthenticating).toBe(true);
    expect(result.userId).toBe(undefined);
    expect(result.methodInProgress).toBe(AuthMethods.init);
    expect(result.errorMessage).toBe(undefined);
    expect(result.successMessage).toBe(undefined);
  });

  it('authenticatedAfterInit', () => {
    const result = reducer(initialState, AuthActions.authenticatedAfterInit({ userId: '123' }));
    expect(result.isAuthenticating).toBe(false);
    expect(result.userId).toBe('123');
    expect(result.methodInProgress).toBe(undefined);
    expect(result.errorMessage).toBe(undefined);
    expect(result.successMessage).toBe(undefined);
  });

  it('authenticatedAfterUserAction', () => {
    const result = reducer(initialState, AuthActions.authenticatedAfterUserAction({ userId: '123' }));
    expect(result.isAuthenticating).toBe(false);
    expect(result.userId).toBe('123');
    expect(result.methodInProgress).toBe(undefined);
    expect(result.errorMessage).toBe(undefined);
    expect(result.successMessage).toBe(undefined);
  });

  it('signedUp', () => {
    const result = reducer(initialState, AuthActions.signedUp({ userId: '123' }));
    expect(result.isAuthenticating).toBe(false);
    expect(result.userId).toBe('123');
    expect(result.methodInProgress).toBe(undefined);
    expect(result.errorMessage).toBe(undefined);
    expect(result.successMessage).toBe(undefined);
  });

  it('notAuthenticated', () => {
    const result = reducer(initialState, AuthActions.notAuthenticated());
    expect(result.isAuthenticating).toBe(false);
    expect(result.userId).toBe(undefined);
    expect(result.methodInProgress).toBe(undefined);
    expect(result.errorMessage).toBe(undefined);
    expect(result.successMessage).toBe(undefined);
  });

  it('authenticateAnonymously', () => {
    const result = reducer(initialState, AuthActions.authenticateAnonymously());
    expect(result.isAuthenticating).toBe(true);
    expect(result.methodInProgress).toBe(AuthMethods.anonymous);
    expect(result.errorMessage).toBe(undefined);
    expect(result.successMessage).toBe(undefined);
  });

  it('authenticateWithGoogle', () => {
    const result = reducer(initialState, AuthActions.authenticateWithGoogle());
    expect(result.isAuthenticating).toBe(true);
    expect(result.methodInProgress).toBe(AuthMethods.google);
    expect(result.errorMessage).toBe(undefined);
    expect(result.successMessage).toBe(undefined);
  });

  it('authenticateWithGitHub', () => {
    const result = reducer(initialState, AuthActions.authenticateWithGitHub());
    expect(result.isAuthenticating).toBe(true);
    expect(result.methodInProgress).toBe(AuthMethods.github);
    expect(result.errorMessage).toBe(undefined);
    expect(result.successMessage).toBe(undefined);
  });

  it('authenticateWithEmailAndPassword', () => {
    const result = reducer(
      initialState,
      AuthActions.authenticateWithEmailAndPassword({ email: testEmail, password: testPassword }),
    );
    expect(result.isAuthenticating).toBe(true);
    expect(result.methodInProgress).toBe(AuthMethods.password);
    expect(result.errorMessage).toBe(undefined);
    expect(result.successMessage).toBe(undefined);
  });

  it('authenticateWithEmailLink', () => {
    const result = reducer(initialState, AuthActions.authenticateWithEmailLink({ email: testEmail }));
    expect(result.isAuthenticating).toBe(true);
    expect(result.methodInProgress).toBe(AuthMethods.link);
    expect(result.errorMessage).toBe(undefined);
    expect(result.successMessage).toBe(undefined);
  });

  it('authenticateWithEmailLinkRequestSent', () => {
    const result = reducer(initialState, AuthActions.authenticateWithEmailLinkRequestSent());
    expect(result.isAuthenticating).toBe(false);
    expect(result.methodInProgress).toBe(undefined);
    expect(result.errorMessage).toBe(undefined);
    expect(result.successMessage).toBe('Magic link has been sent to your email. Follow it to proceed.');
  });

  it('signUpWithEmailAndPassword', () => {
    const result = reducer(
      initialState,
      AuthActions.signUpWithEmailAndPassword({ email: testEmail, password: testPassword }),
    );
    expect(result.isAuthenticating).toBe(true);
    expect(result.methodInProgress).toBe(AuthMethods.password);
    expect(result.errorMessage).toBe(undefined);
    expect(result.successMessage).toBe(undefined);
  });

  it('authenticationFailed', () => {
    const errorMessage = 'Wrong password';
    const result = reducer(initialState, AuthActions.authenticationFailed({ errorMessage }));
    expect(result.isAuthenticating).toBe(false);
    expect(result.userId).toBe(undefined);
    expect(result.methodInProgress).toBe(undefined);
    expect(result.errorMessage).toBe(errorMessage);
    expect(result.successMessage).toBe(undefined);
  });

  it('restorePasswordAttempt', () => {
    const result = reducer(initialState, AuthActions.restorePasswordAttempt({ email: testEmail }));
    expect(result.isAuthenticating).toBe(true);
    expect(result.userId).toBe(undefined);
    expect(result.methodInProgress).toBe(AuthMethods.password);
    expect(result.errorMessage).toBe(undefined);
    expect(result.successMessage).toBe(undefined);
  });

  it('restorePasswordRequestSent', () => {
    const result = reducer(initialState, AuthActions.restorePasswordRequestSent());
    expect(result.isAuthenticating).toBe(false);
    expect(result.userId).toBe(undefined);
    expect(result.methodInProgress).toBe(undefined);
    expect(result.errorMessage).toBe(undefined);
    expect(result.successMessage).toBe('Check your email for password reset instructions.');
  });

  it('signOut', () => {
    const state = { ...initialState, userId: '123' };
    expect(reducer(state, AuthActions.signOut())).toBe(state);
  });

  it('signedOut', () => {
    const state = { ...initialState, userId: '123' };
    const result = reducer(state, AuthActions.signedOut());
    expect(result.userId).toBe(undefined);
  });
});
