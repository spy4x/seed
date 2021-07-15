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
import { AuthSelectors } from '@seed/front/shared/auth/state';
import { AuthProvider } from '@seed/front/shared/types';

describe(AuthEffects.name, () => {
  // region SETUP
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
  const fetchSignInMethodsForEmailMock = jest.fn();

  beforeEach(() => {
    user$ = new ReplaySubject<null | { uid: string }>();
    TestBed.configureTestingModule({
      providers: [
        AuthEffects,
        provideMockActions(() => actions$),
        provideMockStore({
          selectors: [
            {
              selector: AuthSelectors.getEmail,
              value: testEmail,
            },
          ],
        }),
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
            fetchSignInMethodsForEmail: fetchSignInMethodsForEmailMock,
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
  // endregion

  describe('init$', () => {
    it(`dispatches "${AuthAPIActions.initAuthenticated.type}" if fireAuth.user emits User`, () => {
      const action = AuthAPIActions.init();
      const completion = AuthAPIActions.initAuthenticated({ userId: '123' });
      user$.next({ uid: '123' });
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.init$).toBeObservable(expected);
    });

    it(`dispatches "${AuthAPIActions.initNotAuthenticated.type}" if fireAuth.user emits null`, () => {
      const action = AuthAPIActions.init();
      const completion = AuthAPIActions.initNotAuthenticated();
      user$.next(null);
      isSignInWithEmailLinkMock.mockReturnValue(of(false));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.init$).toBeObservable(expected);
    });

    it(`dispatches "${AuthAPIActions.authenticateWithEmailLinkFinish.type}" if fireAuth.user emits null, but Location URL contains SignInWithEmailLink code`, () => {
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

  describe('enterEmail$', () => {
    it(`dispatches "${AuthAPIActions.fetchProviders.type}"`, () => {
      const action = AuthUIActions.enterEmail({ email: testEmail });
      const completion = AuthAPIActions.fetchProviders();
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.enterEmail$).toBeObservable(expected);
    });
  });

  describe('fetchProviders$', () => {
    it(`dispatches "${AuthAPIActions.fetchProvidersSuccess.type}" if fireAuth.fetchSignInMethodsForEmail() returns providers`, () => {
      const action = AuthAPIActions.fetchProviders();
      const providers = [AuthProvider.link, AuthProvider.google]; // TODO map with Firebase Auth Providers string[]
      const completion = AuthAPIActions.fetchProvidersSuccess({ providers });
      fetchSignInMethodsForEmailMock.mockReturnValue(of(providers));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.fetchProviders$).toBeObservable(expected);
      expect(fetchSignInMethodsForEmailMock).toHaveBeenCalled();
    });

    it(`dispatches "${AuthAPIActions.actionFailed.type}" if fireAuth.fetchSignInMethodsForEmail() throws an error`, () => {
      const action = AuthAPIActions.fetchProviders();
      const completion = AuthAPIActions.actionFailed({ message: 'Auth failed' });
      fetchSignInMethodsForEmailMock.mockReturnValue(throwError(new Error('Auth failed')));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.fetchProviders$).toBeObservable(expected);
      expect(fetchSignInMethodsForEmailMock).toHaveBeenCalled();
    });
  });

  describe('chooseProvider$', () => {
    describe(`dispatches authenticate/signIn action for simple providers`, () => {
      it(`"${AuthUIActions.authenticateWithGoogle.type}" for "${AuthProvider.google}" provider`, () => {
        const action = AuthUIActions.chooseProvider({ provider: AuthProvider.google });
        const completion = AuthUIActions.authenticateWithGoogle();
        actions$ = hot('a', { a: action });
        const expected = hot('b', { b: completion });
        expect(effects.chooseProvider$).toBeObservable(expected);
      });

      it(`"${AuthUIActions.authenticateWithGitHub.type}" for "${AuthProvider.github}" provider`, () => {
        const action = AuthUIActions.chooseProvider({ provider: AuthProvider.github });
        const completion = AuthUIActions.authenticateWithGitHub();
        actions$ = hot('a', { a: action });
        const expected = hot('b', { b: completion });
        expect(effects.chooseProvider$).toBeObservable(expected);
      });

      it(`"${AuthUIActions.authenticateWithEmailLink.type}" for "${AuthProvider.link}" provider`, () => {
        const action = AuthUIActions.chooseProvider({ provider: AuthProvider.link });
        const completion = AuthUIActions.authenticateWithEmailLink();
        actions$ = hot('a', { a: action });
        const expected = hot('b', { b: completion });
        expect(effects.chooseProvider$).toBeObservable(expected);
      });

      it(`"${AuthUIActions.signUpAnonymously.type}" for "${AuthProvider.anonymous}" provider`, () => {
        const action = AuthUIActions.chooseProvider({ provider: AuthProvider.anonymous });
        const completion = AuthUIActions.signUpAnonymously();
        actions$ = hot('a', { a: action });
        const expected = hot('b', { b: completion });
        expect(effects.chooseProvider$).toBeObservable(expected);
      });
    });

    describe(`dispatches NoOp Action for more complicated providers`, () => {
      const noopAction = { type: 'noop' };

      it(`for "${AuthProvider.password}" provider`, () => {
        const action = AuthUIActions.chooseProvider({ provider: AuthProvider.password });
        const completion = noopAction;
        actions$ = hot('a', { a: action });
        const expected = hot('b', { b: completion });
        expect(effects.chooseProvider$).toBeObservable(expected);
      });

      it(`for "${AuthProvider.phone}" provider`, () => {
        const action = AuthUIActions.chooseProvider({ provider: AuthProvider.phone });
        const completion = noopAction;
        actions$ = hot('a', { a: action });
        const expected = hot('b', { b: completion });
        expect(effects.chooseProvider$).toBeObservable(expected);
      });
    });
  });

  describe('signUpAnonymously$', () => {
    it(`dispatches "${AuthAPIActions.authenticated.type}" if fireAuth.signInAnonymously() returns User`, () => {
      const action = AuthUIActions.signUpAnonymously();
      const completion = AuthAPIActions.authenticated({ userId: '123' });
      signInAnonymouslyMock.mockReturnValue(
        of({
          user: { uid: '123' },
        }),
      );
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.signUpAnonymously$).toBeObservable(expected);
      expect(signInAnonymouslyMock).toHaveBeenCalled();
    });

    it(`dispatches "${AuthAPIActions.actionFailed.type}" if fireAuth.signInAnonymously() throws an error`, () => {
      const action = AuthUIActions.signUpAnonymously();
      const completion = AuthAPIActions.actionFailed({ message: 'Auth failed' });
      signInAnonymouslyMock.mockReturnValue(throwError(new Error('Auth failed')));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.signUpAnonymously$).toBeObservable(expected);
      expect(signInAnonymouslyMock).toHaveBeenCalled();
    });
  });

  describe('authenticateWithGoogle$', () => {
    it(`dispatches "${AuthAPIActions.authenticated.type}" if fireAuth.signInWithPopup() returns User`, () => {
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

    it(`dispatches "${AuthAPIActions.actionFailed.type}" if fireAuth.signInWithPopup() throws an error`, () => {
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
    it(`dispatches "${AuthAPIActions.authenticated.type}" if fireAuth.signInWithPopup() returns User`, () => {
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

    it(`dispatches "${AuthAPIActions.actionFailed.type}" if fireAuth.signInWithPopup() throws an error`, () => {
      const action = AuthUIActions.authenticateWithGitHub();
      const completion = AuthAPIActions.actionFailed({ message: 'Auth failed' });
      signInWithPopupMock.mockReturnValue(throwError(new Error('Auth failed')));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.authenticateWithGitHub$).toBeObservable(expected);
      expect(signInWithPopupMock).toHaveBeenCalledWith(new firebase.auth.GithubAuthProvider());
    });
  });

  describe('signOut$', () => {
    it(`dispatches "${AuthAPIActions.signedOut.type}" after calling fireAuth.signOut()`, () => {
      const action = AuthUIActions.signOut();
      const completion = AuthAPIActions.signedOut();
      signOutMock.mockReturnValue(of(undefined));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.signOut$).toBeObservable(expected);
      expect(signOutMock).toHaveBeenCalled();
    });
  });

  describe('authenticateWithEmailAndPassword$', () => {
    it(`dispatches "${AuthAPIActions.authenticated.type}" if fireAuth.signInWithEmailAndPassword() returns User`, () => {
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

    it(`dispatches "${AuthAPIActions.actionFailed.type}" if fireAuth.signInWithEmailAndPassword() throws an error`, () => {
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
    it(`dispatches "${AuthAPIActions.authenticateWithEmailLinkRequestSent.type}" if fireAuth.sendSignInLinkToEmail() succeeds`, () => {
      const action = AuthUIActions.authenticateWithEmailLink();
      const completion = AuthAPIActions.authenticateWithEmailLinkRequestSent();
      sendSignInLinkToEmailMock.mockReturnValue(of(undefined));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.authenticateWithEmailLink$).toBeObservable(expected);
      expect(localStorage[AUTH_EFFECTS_EMAIL_LINK_LOCAL_STORAGE_KEY]).toBe(testEmail);
      expect(sendSignInLinkToEmailMock).toHaveBeenCalledWith(testEmail, { url: location.href, handleCodeInApp: true });
    });

    it(`dispatches "${AuthAPIActions.actionFailed.type}" if fireAuth.sendSignInLinkToEmail() throws an error`, () => {
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
    it(`dispatches "${AuthAPIActions.authenticated.type}" if fireAuth.signInWithEmailLink() returns User`, () => {
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

    it(`dispatches "${AuthAPIActions.actionFailed.type}" if no email is provided`, () => {
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

    it(`dispatches "${AuthAPIActions.actionFailed.type}" if fireAuth.signInWithEmailLink() throws an error`, () => {
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
    it(`dispatches "${AuthAPIActions.signedUp.type}" if fireAuth.createUserWithEmailAndPassword() returns User`, () => {
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

    it(`dispatches "${AuthAPIActions.actionFailed.type}" if fireAuth.createUserWithEmailAndPassword() throws an error`, () => {
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
    it(`dispatches "${AuthAPIActions.restorePasswordSuccess.type}" if fireAuth.sendPasswordResetEmail() returns providers`, () => {
      const action = AuthUIActions.restorePassword();
      const completion = AuthAPIActions.restorePasswordSuccess();
      sendPasswordResetEmailMock.mockReturnValue(of(undefined));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.restorePassword$).toBeObservable(expected);
      expect(sendPasswordResetEmailMock).toHaveBeenCalledWith(testEmail);
    });

    it(`dispatches "${AuthAPIActions.actionFailed.type}" if fireAuth.sendPasswordResetEmail() throws an error`, () => {
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
