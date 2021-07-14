import { TestBed } from '@angular/core/testing';
import { Observable, of, ReplaySubject, throwError } from 'rxjs';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { AUTH_EFFECTS_EMAIL_LINK_LOCAL_STORAGE_KEY, AuthEffects } from './auth.effects';
import * as AuthUIActions from './actions/ui.actions';
import * as AuthAPIActions from './actions/api.actions';
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
      const action = AuthAPIActions.init();
      const completion = AuthAPIActions.initAuthenticated({ userId: '123' });
      user$.next({ uid: '123' });
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.init$).toBeObservable(expected);
    });

    it('fail', () => {
      const action = AuthAPIActions.init();
      const completion = AuthAPIActions.initNotAuthenticated();
      user$.next(null);
      isSignInWithEmailLinkMock.mockReturnValue(of(false));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.init$).toBeObservable(expected);
    });

    it('proceed with email link', () => {
      const action = AuthAPIActions.init();
      const completion = AuthAPIActions.authenticateWithEmailLinkFinish();
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
      const action = AuthUIActions.signUpAnonymously();
      const completion = AuthAPIActions.authenticated({ userId: '123' });
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
      const action = AuthUIActions.signUpAnonymously();
      const completion = AuthAPIActions.actionFailed({ message: 'Auth failed' });
      signInAnonymouslyMock.mockReturnValue(throwError(new Error('Auth failed')));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.authenticateAnonymously$).toBeObservable(expected);
      expect(signInAnonymouslyMock).toHaveBeenCalled();
    });
  });

  describe('authenticateWithGoogle$', () => {
    it('success', () => {
      const action = AuthUIActions.authenticateWithGoogle();
      const completion = AuthAPIActions.authenticated({ userId: '123' });
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
      const action = AuthUIActions.authenticateWithGoogle();
      const completion = AuthAPIActions.actionFailed({ message: 'Auth failed' });
      signInWithPopupMock.mockReturnValue(throwError(new Error('Auth failed')));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.authenticateWithGoogle$).toBeObservable(expected);
      expect(signInWithPopupMock).toHaveBeenCalledWith(new firebase.auth.GoogleAuthProvider());
    });
  });

  describe('authenticateWithGitHub$', () => {
    it('success', () => {
      const action = AuthUIActions.authenticateWithGitHub();
      const completion = AuthAPIActions.authenticated({ userId: '123' });
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
      const action = AuthUIActions.authenticateWithGitHub();
      const completion = AuthAPIActions.actionFailed({ message: 'Auth failed' });
      signInWithPopupMock.mockReturnValue(throwError(new Error('Auth failed')));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.authenticateWithGitHub$).toBeObservable(expected);
      expect(signInWithPopupMock).toHaveBeenCalledWith(new firebase.auth.GithubAuthProvider());
    });
  });

  it('signOut$', () => {
    const action = AuthUIActions.signOut();
    const completion = AuthAPIActions.signedOut();
    signOutMock.mockReturnValue(of(undefined));
    actions$ = hot('a', { a: action });
    const expected = hot('b', { b: completion });
    expect(effects.signOut$).toBeObservable(expected);
    expect(signOutMock).toHaveBeenCalled();
  });

  describe('authenticateWithEmailAndPassword$', () => {
    it('success', () => {
      const action = AuthUIActions.signInWithEmailAndPassword({ password: testPassword });
      const completion = AuthAPIActions.authenticated({ userId: '123' });
      signInWithEmailAndPasswordMock.mockReturnValue(
        of({
          user: { uid: '123' },
        }),
      );
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.signInWithEmailAndPassword$).toBeObservable(expected);
      expect(signInWithEmailAndPasswordMock).toHaveBeenCalledWith(testEmail, testPassword);
    });

    it('fail', () => {
      const action = AuthUIActions.signInWithEmailAndPassword({ password: testPassword });
      const completion = AuthAPIActions.actionFailed({ message: 'Auth failed' });
      signInWithEmailAndPasswordMock.mockReturnValue(throwError(new Error('Auth failed')));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.signInWithEmailAndPassword$).toBeObservable(expected);
      expect(signInWithEmailAndPasswordMock).toHaveBeenCalledWith(testEmail, testPassword);
    });
  });

  describe('authenticateWithEmailLink$', () => {
    it('success', () => {
      const action = AuthUIActions.authenticateWithEmailLink();
      const completion = AuthAPIActions.authenticateWithEmailLinkRequestSent();
      sendSignInLinkToEmailMock.mockReturnValue(of(undefined));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.authenticateWithEmailLink$).toBeObservable(expected);
      expect(localStorage[AUTH_EFFECTS_EMAIL_LINK_LOCAL_STORAGE_KEY]).toBe(testEmail);
      expect(sendSignInLinkToEmailMock).toHaveBeenCalledWith(testEmail, { url: location.href, handleCodeInApp: true });
    });

    it('fail', () => {
      const action = AuthUIActions.authenticateWithEmailLink();
      const completion = AuthAPIActions.actionFailed({ message: 'Auth failed' });
      sendSignInLinkToEmailMock.mockReturnValue(throwError(new Error('Auth failed')));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.authenticateWithEmailLink$).toBeObservable(expected);
      expect(sendSignInLinkToEmailMock).toHaveBeenCalledWith(testEmail, { url: location.href, handleCodeInApp: true });
    });
  });

  describe('authenticateWithEmailLinkFinish$', () => {
    it('success', () => {
      const action = AuthAPIActions.authenticateWithEmailLinkFinish();
      const completion = AuthAPIActions.authenticated({ userId: '123' });
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
      const action = AuthAPIActions.authenticateWithEmailLinkFinish();
      const completion = AuthAPIActions.actionFailed({
        message: 'No email was provided for link authentication. Try again.',
      });
      localStorage[AUTH_EFFECTS_EMAIL_LINK_LOCAL_STORAGE_KEY] = undefined;
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.authenticateWithEmailLinkFinish$).toBeObservable(expected);
      expect(signInWithEmailLinkMock).not.toHaveBeenCalledWith();
    });

    it('fail because of firebase auth error', () => {
      const action = AuthAPIActions.authenticateWithEmailLinkFinish();
      const completion = AuthAPIActions.actionFailed({ message: 'Auth failed' });
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
      const action = AuthUIActions.signUpWithEmailAndPassword({ password: testPassword });
      const completion = AuthAPIActions.signedUp({ userId: '123' });
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
      const action = AuthUIActions.signUpWithEmailAndPassword({ password: testPassword });
      const completion = AuthAPIActions.actionFailed({ message: 'Auth failed' });
      createUserWithEmailAndPasswordMock.mockReturnValue(throwError(new Error('Auth failed')));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.signUpWithEmailAndPassword$).toBeObservable(expected);
      expect(createUserWithEmailAndPasswordMock).toHaveBeenCalledWith(testEmail, testPassword);
    });
  });

  describe('restorePassword$', () => {
    it('success', () => {
      const action = AuthUIActions.restorePassword();
      const completion = AuthAPIActions.restorePasswordSuccess();
      sendPasswordResetEmailMock.mockReturnValue(of(undefined));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.restorePassword$).toBeObservable(expected);
      expect(sendPasswordResetEmailMock).toHaveBeenCalledWith(testEmail);
    });

    it('fail', () => {
      const action = AuthUIActions.restorePassword();
      const completion = AuthAPIActions.actionFailed({ message: 'Auth failed' });
      sendPasswordResetEmailMock.mockReturnValue(throwError(new Error('Auth failed')));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.restorePassword$).toBeObservable(expected);
      expect(sendPasswordResetEmailMock).toHaveBeenCalledWith(testEmail);
    });
  });
});
