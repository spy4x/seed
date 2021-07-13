import { TestBed } from '@angular/core/testing';
import { Observable, of, ReplaySubject, throwError } from 'rxjs';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { AUTH_EFFECTS_EMAIL_LINK_LOCAL_STORAGE_KEY, AuthEffects } from './auth.effects';
import * as AuthActions from './auth.actions';
import { AngularFireAuth } from '@angular/fire/auth';
import { hot } from '@nrwl/angular/testing';
import { Action } from '@ngrx/store';
import firebase from 'firebase/app';
import { testEmail, testPassword } from '@seed/shared/mock-data';

describe(AuthEffects.name, () => {
  let actions$ = new Observable<Action>();
  let effects: AuthEffects;
  let user$: ReplaySubject<null | { uid: string }>;
  const signInAnonymouslyMock = jest.fn();
  const signInWithPopupMock = jest.fn();
  const signOutMock = jest.fn();
  const signInWithEmailAndPasswordMock = jest.fn();
  const createUserWithEmailAndPasswordMock = jest.fn();
  const sendPasswordResetEmailMock = jest.fn();
  const sendSignInLinkToEmailMock = jest.fn();
  const isSignInWithEmailLinkMock = jest.fn();
  const signInWithEmailLinkMock = jest.fn();

  beforeEach(() => {
    user$ = new ReplaySubject<null | { uid: string }>();
    TestBed.configureTestingModule({
      providers: [
        AuthEffects,
        provideMockActions(() => actions$),
        provideMockStore(),
        {
          provide: AngularFireAuth,
          useValue: {
            user: user$,
            signInAnonymously: signInAnonymouslyMock,
            signInWithPopup: signInWithPopupMock,
            signInWithEmailAndPassword: signInWithEmailAndPasswordMock,
            createUserWithEmailAndPassword: createUserWithEmailAndPasswordMock,
            sendPasswordResetEmail: sendPasswordResetEmailMock,
            sendSignInLinkToEmail: sendSignInLinkToEmailMock,
            isSignInWithEmailLink: isSignInWithEmailLinkMock,
            signInWithEmailLink: signInWithEmailLinkMock,
            signOut: signOutMock,
          },
        },
      ],
    });
    effects = TestBed.inject(AuthEffects);
    signInAnonymouslyMock.mockReset();
    signInWithPopupMock.mockReset();
    signOutMock.mockReset();
    signInWithEmailAndPasswordMock.mockReset();
    createUserWithEmailAndPasswordMock.mockReset();
    sendPasswordResetEmailMock.mockReset();
    sendSignInLinkToEmailMock.mockReset();
    isSignInWithEmailLinkMock.mockReset();
    signInWithEmailLinkMock.mockReset();
  });

  describe('init$', () => {
    it('success', () => {
      const action = AuthActions.init();
      const completion = AuthActions.authenticatedAfterInit({ userId: '123' });
      user$.next({ uid: '123' });
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.init$).toBeObservable(expected);
    });

    it('fail', () => {
      const action = AuthActions.init();
      const completion = AuthActions.notAuthenticated();
      user$.next(null);
      isSignInWithEmailLinkMock.mockReturnValue(of(false));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.init$).toBeObservable(expected);
    });

    it('proceed with email link', () => {
      const action = AuthActions.init();
      const completion = AuthActions.authenticateWithEmailLinkFinish();
      const url = 'https://seed.web.app/auth-link';
      delete (window as any).location;
      (window.location as any) = new URL(url);
      isSignInWithEmailLinkMock.mockReturnValue(of(true));
      user$.next(null);
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.init$).toBeObservable(expected);
      expect(isSignInWithEmailLinkMock).toHaveBeenCalledWith(url);
    });
  });

  describe('authenticateAnonymously$', () => {
    it('success', () => {
      const action = AuthActions.authenticateAnonymously();
      const completion = AuthActions.authenticatedAfterUserAction({ userId: '123' });
      signInAnonymouslyMock.mockReturnValue(
        of({
          user: { uid: '123' },
        }),
      );
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.authenticateAnonymously$).toBeObservable(expected);
      expect(signInAnonymouslyMock).toHaveBeenCalled();
    });

    it('fail', () => {
      const action = AuthActions.authenticateAnonymously();
      const completion = AuthActions.authenticationFailed({ errorMessage: 'Auth failed' });
      signInAnonymouslyMock.mockReturnValue(throwError(new Error('Auth failed')));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.authenticateAnonymously$).toBeObservable(expected);
      expect(signInAnonymouslyMock).toHaveBeenCalled();
    });
  });

  describe('authenticateWithGoogle$', () => {
    it('success', () => {
      const action = AuthActions.authenticateWithGoogle();
      const completion = AuthActions.authenticatedAfterUserAction({ userId: '123' });
      signInWithPopupMock.mockReturnValue(
        of({
          user: { uid: '123' },
        }),
      );
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.authenticateWithGoogle$).toBeObservable(expected);
      expect(signInWithPopupMock).toHaveBeenCalledWith(new firebase.auth.GoogleAuthProvider());
    });

    it('fail', () => {
      const action = AuthActions.authenticateWithGoogle();
      const completion = AuthActions.authenticationFailed({ errorMessage: 'Auth failed' });
      signInWithPopupMock.mockReturnValue(throwError(new Error('Auth failed')));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.authenticateWithGoogle$).toBeObservable(expected);
      expect(signInWithPopupMock).toHaveBeenCalledWith(new firebase.auth.GoogleAuthProvider());
    });
  });

  describe('authenticateWithGitHub$', () => {
    it('success', () => {
      const action = AuthActions.authenticateWithGitHub();
      const completion = AuthActions.authenticatedAfterUserAction({ userId: '123' });
      signInWithPopupMock.mockReturnValue(
        of({
          user: { uid: '123' },
        }),
      );
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.authenticateWithGitHub$).toBeObservable(expected);
      expect(signInWithPopupMock).toHaveBeenCalledWith(new firebase.auth.GithubAuthProvider());
    });

    it('fail', () => {
      const action = AuthActions.authenticateWithGitHub();
      const completion = AuthActions.authenticationFailed({ errorMessage: 'Auth failed' });
      signInWithPopupMock.mockReturnValue(throwError(new Error('Auth failed')));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.authenticateWithGitHub$).toBeObservable(expected);
      expect(signInWithPopupMock).toHaveBeenCalledWith(new firebase.auth.GithubAuthProvider());
    });
  });

  it('signOut$', () => {
    const action = AuthActions.signOut();
    const completion = AuthActions.signedOut();
    signOutMock.mockReturnValue(of(undefined));
    actions$ = hot('a', { a: action });
    const expected = hot('b', { b: completion });
    expect(effects.signOut$).toBeObservable(expected);
    expect(signOutMock).toHaveBeenCalled();
  });

  describe('authenticateWithEmailAndPassword$', () => {
    it('success', () => {
      const action = AuthActions.authenticateWithEmailAndPassword({ email: testEmail, password: testPassword });
      const completion = AuthActions.authenticatedAfterUserAction({ userId: '123' });
      signInWithEmailAndPasswordMock.mockReturnValue(
        of({
          user: { uid: '123' },
        }),
      );
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.authenticateWithEmailAndPassword$).toBeObservable(expected);
      expect(signInWithEmailAndPasswordMock).toHaveBeenCalledWith(testEmail, testPassword);
    });

    it('fail', () => {
      const action = AuthActions.authenticateWithEmailAndPassword({ email: testEmail, password: testPassword });
      const completion = AuthActions.authenticationFailed({ errorMessage: 'Auth failed' });
      signInWithEmailAndPasswordMock.mockReturnValue(throwError(new Error('Auth failed')));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.authenticateWithEmailAndPassword$).toBeObservable(expected);
      expect(signInWithEmailAndPasswordMock).toHaveBeenCalledWith(testEmail, testPassword);
    });
  });

  describe('authenticateWithEmailLink$', () => {
    it('success', () => {
      const action = AuthActions.authenticateWithEmailLink({ email: testEmail });
      const completion = AuthActions.authenticateWithEmailLinkRequestSent();
      sendSignInLinkToEmailMock.mockReturnValue(of(undefined));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.authenticateWithEmailLink$).toBeObservable(expected);
      expect(localStorage[AUTH_EFFECTS_EMAIL_LINK_LOCAL_STORAGE_KEY]).toBe(testEmail);
      expect(sendSignInLinkToEmailMock).toHaveBeenCalledWith(testEmail, { url: location.href, handleCodeInApp: true });
    });

    it('fail', () => {
      const action = AuthActions.authenticateWithEmailLink({ email: testEmail });
      const completion = AuthActions.authenticationFailed({ errorMessage: 'Auth failed' });
      sendSignInLinkToEmailMock.mockReturnValue(throwError(new Error('Auth failed')));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.authenticateWithEmailLink$).toBeObservable(expected);
      expect(sendSignInLinkToEmailMock).toHaveBeenCalledWith(testEmail, { url: location.href, handleCodeInApp: true });
    });
  });

  describe('authenticateWithEmailLinkFinish$', () => {
    it('success', () => {
      const action = AuthActions.authenticateWithEmailLinkFinish();
      const completion = AuthActions.authenticatedAfterUserAction({ userId: '123' });
      localStorage[AUTH_EFFECTS_EMAIL_LINK_LOCAL_STORAGE_KEY] = testEmail;
      signInWithEmailLinkMock.mockReturnValue(
        of({
          user: { uid: '123' },
        }),
      );
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.authenticateWithEmailLinkFinish$).toBeObservable(expected);
      expect(signInWithEmailLinkMock).toHaveBeenCalledWith(testEmail, location.href);
    });

    it('fail with no email provided', () => {
      const action = AuthActions.authenticateWithEmailLinkFinish();
      const completion = AuthActions.authenticationFailed({
        errorMessage: 'No email was provided for link authentication. Try again.',
      });
      localStorage[AUTH_EFFECTS_EMAIL_LINK_LOCAL_STORAGE_KEY] = undefined;
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.authenticateWithEmailLinkFinish$).toBeObservable(expected);
      expect(signInWithEmailLinkMock).not.toHaveBeenCalledWith();
    });

    it('fail because of firebase auth error', () => {
      const action = AuthActions.authenticateWithEmailLinkFinish();
      const completion = AuthActions.authenticationFailed({ errorMessage: 'Auth failed' });
      signInWithEmailLinkMock.mockReturnValue(throwError(new Error('Auth failed')));
      localStorage[AUTH_EFFECTS_EMAIL_LINK_LOCAL_STORAGE_KEY] = testEmail;
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.authenticateWithEmailLinkFinish$).toBeObservable(expected);
      expect(signInWithEmailLinkMock).toHaveBeenCalledWith(testEmail, location.href);
    });
  });

  describe('signUpWithEmailAndPassword$', () => {
    it('success', () => {
      const action = AuthActions.signUpWithEmailAndPassword({ email: testEmail, password: testPassword });
      const completion = AuthActions.signedUp({ userId: '123' });
      createUserWithEmailAndPasswordMock.mockReturnValue(
        of({
          user: { uid: '123' },
        }),
      );
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.signUpWithEmailAndPassword$).toBeObservable(expected);
      expect(createUserWithEmailAndPasswordMock).toHaveBeenCalledWith(testEmail, testPassword);
    });

    it('fail', () => {
      const action = AuthActions.signUpWithEmailAndPassword({ email: testEmail, password: testPassword });
      const completion = AuthActions.authenticationFailed({ errorMessage: 'Auth failed' });
      createUserWithEmailAndPasswordMock.mockReturnValue(throwError(new Error('Auth failed')));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.signUpWithEmailAndPassword$).toBeObservable(expected);
      expect(createUserWithEmailAndPasswordMock).toHaveBeenCalledWith(testEmail, testPassword);
    });
  });

  describe('restorePassword$', () => {
    it('success', () => {
      const action = AuthActions.restorePasswordAttempt({ email: testEmail });
      const completion = AuthActions.restorePasswordRequestSent();
      sendPasswordResetEmailMock.mockReturnValue(of(undefined));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.restorePassword$).toBeObservable(expected);
      expect(sendPasswordResetEmailMock).toHaveBeenCalledWith(testEmail);
    });

    it('fail', () => {
      const action = AuthActions.restorePasswordAttempt({ email: testEmail });
      const completion = AuthActions.authenticationFailed({ errorMessage: 'Auth failed' });
      sendPasswordResetEmailMock.mockReturnValue(throwError(new Error('Auth failed')));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.restorePassword$).toBeObservable(expected);
      expect(sendPasswordResetEmailMock).toHaveBeenCalledWith(testEmail);
    });
  });
});
