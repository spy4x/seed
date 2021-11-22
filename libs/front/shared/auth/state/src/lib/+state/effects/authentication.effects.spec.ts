import { TestBed } from '@angular/core/testing';
import { Observable, of, ReplaySubject, throwError } from 'rxjs';
import { provideMockActions } from '@ngrx/effects/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import {
  AUTH_REHYDRATION_KEY_DISPLAY_NAME,
  AUTH_REHYDRATION_KEY_EMAIL,
  AUTH_REHYDRATION_KEY_PHOTO_URL,
  AUTH_URL_SEGMENT_FOR_LINK_AUTH,
  AuthenticationEffects,
} from './authentication.effects';
import * as AuthUIActions from '../actions/ui.actions';
import * as AuthAPIActions from '../actions/api.actions';
import { AngularFireAuth } from '@angular/fire/auth';
import { hot } from '@nrwl/angular/testing';
import { Action } from '@ngrx/store';
import firebase from 'firebase/app';
import { testDisplayName, testEmail, testPassword, testPhotoURL, testUserId } from '@seed/shared/mock-data';
import * as AuthSelectors from '../auth.selectors';
import { AuthProvider } from '@seed/front/shared/types';
import { mockAuthCredentials, mockExpectedActionPayload } from '../mocks';
import { setMilliseconds, subMinutes } from 'date-fns';
import { RouterSelectors } from '@seed/front/shared/router';

describe(AuthenticationEffects.name, () => {
  // region SETUP
  let store: MockStore;
  let actions$ = new Observable<Action>();
  let effects: AuthenticationEffects;
  let user$: ReplaySubject<null | { uid: string; email?: string; displayName?: string; photoURL?: string }>;
  let idToken$: ReplaySubject<null | string>;
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
    idToken$ = new ReplaySubject<null | string>();
    TestBed.configureTestingModule({
      providers: [
        AuthenticationEffects,
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
            idToken: idToken$,
          },
        },
      ],
    });
    store = TestBed.inject(MockStore);
    effects = TestBed.inject(AuthenticationEffects);
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
    it(`dispatches "${AuthAPIActions.initSignedIn.type}" if fireAuth.user emits User`, () => {
      const action = AuthAPIActions.init();
      const completion = AuthAPIActions.initSignedIn(mockExpectedActionPayload);
      user$.next(mockAuthCredentials.user);
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.init$).toBeObservable(expected);
    });

    it(`dispatches "${AuthAPIActions.signEmailLinkFinish.type}" if fireAuth.user emits null, but Location URL contains SignInWithEmailLink code`, () => {
      const action = AuthAPIActions.init();
      const completion = AuthAPIActions.signEmailLinkFinish();
      const url = `https://seed.web.app/auth-link?${AUTH_URL_SEGMENT_FOR_LINK_AUTH}=${testEmail}`;
      delete (window as any).location;
      (window.location as any) = new URL(url);
      isSignInWithEmailLinkMock.mockReturnValue(of(true));
      user$.next(null);
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.init$).toBeObservable(expected);
      expect(isSignInWithEmailLinkMock).toHaveBeenCalledWith(url);
    });

    it(`dispatches "${AuthAPIActions.actionFailed.type}" if fireAuth.isSignInWithEmailLink() throws an error`, () => {
      const action = AuthAPIActions.init();
      const completion = AuthAPIActions.actionFailed({ message: 'Auth failed' });
      const url = `https://seed.web.app/auth-link?${AUTH_URL_SEGMENT_FOR_LINK_AUTH}=${testEmail}`;
      delete (window as any).location;
      (window.location as any) = new URL(url);
      isSignInWithEmailLinkMock.mockReturnValue(throwError(new Error('Auth failed')));
      user$.next(null);
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.init$).toBeObservable(expected);
      expect(isSignInWithEmailLinkMock).toHaveBeenCalledWith(url);
    });

    it(`dispatches "${AuthAPIActions.initNotAuthenticated.type}" if fireAuth.user emits null, no signInEmailLink and no email in localStorage`, () => {
      const action = AuthAPIActions.init();
      const completion = AuthAPIActions.initNotAuthenticated();
      localStorage.removeItem(AUTH_REHYDRATION_KEY_EMAIL);
      const localStorageGetItemSpy = jest.spyOn(window.localStorage.__proto__, 'getItem'); // https://stackoverflow.com/a/54157998/9967802
      user$.next(null);
      isSignInWithEmailLinkMock.mockReturnValue(of(false));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.init$).toBeObservable(expected);
      expect(localStorageGetItemSpy).toHaveBeenCalledWith(AUTH_REHYDRATION_KEY_EMAIL);
    });

    it(`dispatches "${AuthAPIActions.initNotAuthenticatedButRehydrateState.type}" if fireAuth.user emits null, no signInEmailLink, with user data in localStorage`, () => {
      const action = AuthAPIActions.init();
      const completion = AuthAPIActions.initNotAuthenticatedButRehydrateState({
        email: testEmail,
        displayName: testDisplayName,
        photoURL: testPhotoURL,
      });
      localStorage.setItem(AUTH_REHYDRATION_KEY_EMAIL, testEmail);
      localStorage.setItem(AUTH_REHYDRATION_KEY_DISPLAY_NAME, testDisplayName);
      localStorage.setItem(AUTH_REHYDRATION_KEY_PHOTO_URL, testPhotoURL);
      const localStorageGetItemSpy = jest.spyOn(window.localStorage.__proto__, 'getItem'); // https://stackoverflow.com/a/54157998/9967802
      user$.next(null);
      isSignInWithEmailLinkMock.mockReturnValue(of(false));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.init$).toBeObservable(expected);
      expect(localStorageGetItemSpy).toHaveBeenCalledWith(AUTH_REHYDRATION_KEY_EMAIL);
      expect(localStorageGetItemSpy).toHaveBeenCalledWith(AUTH_REHYDRATION_KEY_DISPLAY_NAME);
      expect(localStorageGetItemSpy).toHaveBeenCalledWith(AUTH_REHYDRATION_KEY_PHOTO_URL);
    });
  });

  describe('saveOriginalURL$', () => {
    it(`dispatches "${AuthAPIActions.saveOriginalURL.type}" with current url`, () => {
      const url = '/my-url';
      store.overrideSelector(RouterSelectors.getUrl, url);
      const action = AuthAPIActions.init();
      const completion = AuthAPIActions.saveOriginalURL({ url });
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.saveOriginalURL$).toBeObservable(expected);
    });
  });

  describe('enterEmail$', () => {
    it(`dispatches "${AuthAPIActions.fetchProviders.type}" on "enterEmail" and saves email to localStorage`, () => {
      const action = AuthUIActions.enterEmail({ email: testEmail });
      const completion = AuthAPIActions.fetchProviders();
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      const localStorageSetItemSpy = jest.spyOn(window.localStorage.__proto__, 'setItem'); // https://stackoverflow.com/a/54157998/9967802
      expect(effects.enterEmail$).toBeObservable(expected);
      expect(localStorageSetItemSpy).toHaveBeenCalledWith(AUTH_REHYDRATION_KEY_EMAIL, testEmail);
      expect(localStorage.getItem(AUTH_REHYDRATION_KEY_EMAIL)).toBe(testEmail);
    });
    it(`dispatches "${AuthAPIActions.fetchProviders.type}" on "initNotAuthenticatedButRehydrateEmail"`, () => {
      const action = AuthAPIActions.initNotAuthenticatedButRehydrateState({ email: testEmail });
      const completion = AuthAPIActions.fetchProviders();
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.enterEmail$).toBeObservable(expected);
    });
  });

  describe('fetchProviders$', () => {
    it(`dispatches "${AuthAPIActions.fetchProvidersSuccess.type}" if fireAuth.fetchSignInMethodsForEmail() returns providers`, () => {
      const action = AuthAPIActions.fetchProviders();
      const firebaseProviders = ['google.com', 'github.com', 'password', 'emailLink'];
      const authProviders = [AuthProvider.google, AuthProvider.github, AuthProvider.password, AuthProvider.link];
      const completion = AuthAPIActions.fetchProvidersSuccess({ providers: authProviders });
      fetchSignInMethodsForEmailMock.mockReturnValue(of(firebaseProviders));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.fetchProviders$).toBeObservable(expected);
      expect(fetchSignInMethodsForEmailMock).toHaveBeenCalled();
    });

    it(`dispatches "${AuthAPIActions.fetchProvidersSuccess.type}" if fireAuth.fetchSignInMethodsForEmail() returns empty providers`, () => {
      const action = AuthAPIActions.fetchProviders();
      const firebaseProviders: string[] = [];
      const authProviders: AuthProvider[] = [];
      const completion = AuthAPIActions.fetchProvidersSuccess({ providers: authProviders });
      fetchSignInMethodsForEmailMock.mockReturnValue(of(firebaseProviders));
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

  describe('selectProvider$', () => {
    describe(`dispatches authenticate/signIn action for simple providers`, () => {
      it(`"${AuthUIActions.signGoogle.type}" for "${AuthProvider.google}" provider`, () => {
        const action = AuthUIActions.selectProvider({ provider: AuthProvider.google });
        const completion = AuthUIActions.signGoogle();
        actions$ = hot('a', { a: action });
        const expected = hot('b', { b: completion });
        expect(effects.selectProvider$).toBeObservable(expected);
      });

      it(`"${AuthUIActions.signGitHub.type}" for "${AuthProvider.github}" provider`, () => {
        const action = AuthUIActions.selectProvider({ provider: AuthProvider.github });
        const completion = AuthUIActions.signGitHub();
        actions$ = hot('a', { a: action });
        const expected = hot('b', { b: completion });
        expect(effects.selectProvider$).toBeObservable(expected);
      });

      it(`"${AuthUIActions.signEmailLink.type}" for "${AuthProvider.link}" provider`, () => {
        const action = AuthUIActions.selectProvider({ provider: AuthProvider.link });
        const completion = AuthUIActions.signEmailLink();
        actions$ = hot('a', { a: action });
        const expected = hot('b', { b: completion });
        expect(effects.selectProvider$).toBeObservable(expected);
      });

      it(`"${AuthUIActions.signAnonymously.type}" for "${AuthProvider.anonymous}" provider`, () => {
        const action = AuthUIActions.selectProvider({ provider: AuthProvider.anonymous });
        const completion = AuthUIActions.signAnonymously();
        actions$ = hot('a', { a: action });
        const expected = hot('b', { b: completion });
        expect(effects.selectProvider$).toBeObservable(expected);
      });
    });

    describe(`dispatches NoOp Action for more complicated providers`, () => {
      const noopAction = { type: 'noop' };

      it(`for "${AuthProvider.password}" provider`, () => {
        const action = AuthUIActions.selectProvider({ provider: AuthProvider.password });
        const completion = noopAction;
        actions$ = hot('a', { a: action });
        const expected = hot('b', { b: completion });
        expect(effects.selectProvider$).toBeObservable(expected);
      });

      it(`for "${AuthProvider.phone}" provider`, () => {
        const action = AuthUIActions.selectProvider({ provider: AuthProvider.phone });
        const completion = noopAction;
        actions$ = hot('a', { a: action });
        const expected = hot('b', { b: completion });
        expect(effects.selectProvider$).toBeObservable(expected);
      });
    });
  });

  describe(`signAnonymously$`, () => {
    it(`dispatches "${AuthAPIActions.signedIn.type}" if fireAuth.signInAnonymously() returns User`, () => {
      const action = AuthUIActions.signAnonymously();
      const completion = AuthAPIActions.signedIn(mockExpectedActionPayload);
      signInAnonymouslyMock.mockReturnValue(of(mockAuthCredentials));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.signAnonymously$).toBeObservable(expected);
      expect(signInAnonymouslyMock).toHaveBeenCalled();
    });

    it(`dispatches "${AuthAPIActions.actionFailed.type}" if fireAuth.signInAnonymously() throws an error`, () => {
      const action = AuthUIActions.signAnonymously();
      const completion = AuthAPIActions.actionFailed({ message: 'Auth failed' });
      signInAnonymouslyMock.mockReturnValue(throwError(new Error('Auth failed')));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.signAnonymously$).toBeObservable(expected);
      expect(signInAnonymouslyMock).toHaveBeenCalled();
    });
  });

  describe('signGoogle$', () => {
    it(`dispatches "${AuthAPIActions.signedIn.type}" if fireAuth.signInWithPopup() returns User`, () => {
      const action = AuthUIActions.signGoogle();
      const completion = AuthAPIActions.signedIn(mockExpectedActionPayload);
      signInWithPopupMock.mockReturnValue(of(mockAuthCredentials));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.signGoogle$).toBeObservable(expected);
      expect(signInWithPopupMock).toHaveBeenCalledWith(new firebase.auth.GoogleAuthProvider());
    });

    it(`dispatches "${AuthAPIActions.actionFailed.type}" if fireAuth.signInWithPopup() throws an error`, () => {
      const action = AuthUIActions.signGoogle();
      const completion = AuthAPIActions.actionFailed({ message: 'Auth failed' });
      signInWithPopupMock.mockReturnValue(throwError(new Error('Auth failed')));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.signGoogle$).toBeObservable(expected);
      expect(signInWithPopupMock).toHaveBeenCalledWith(new firebase.auth.GoogleAuthProvider());
    });
  });

  describe('signGitHub$', () => {
    it(`dispatches "${AuthAPIActions.signedIn.type}" if fireAuth.signInWithPopup() returns User`, () => {
      const action = AuthUIActions.signGitHub();
      const completion = AuthAPIActions.signedIn(mockExpectedActionPayload);
      signInWithPopupMock.mockReturnValue(of(mockAuthCredentials));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.signGitHub$).toBeObservable(expected);
      expect(signInWithPopupMock).toHaveBeenCalledWith(new firebase.auth.GithubAuthProvider());
    });

    it(`dispatches "${AuthAPIActions.actionFailed.type}" if fireAuth.signInWithPopup() throws an error`, () => {
      const action = AuthUIActions.signGitHub();
      const completion = AuthAPIActions.actionFailed({ message: 'Auth failed' });
      signInWithPopupMock.mockReturnValue(throwError(new Error('Auth failed')));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.signGitHub$).toBeObservable(expected);
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

  describe('signEmailPassword$', () => {
    const action = AuthUIActions.signEmailPassword({ password: testPassword });
    beforeEach(() => {
      store.overrideSelector(AuthSelectors.getEmail, testEmail);
    });

    describe(`signUp`, () => {
      const signUpCredential = { ...mockAuthCredentials, additionalUserInfo: { isNewUser: true } };
      const signUpExpectedActionPayload = { ...mockExpectedActionPayload, isNewUser: true };
      beforeEach(() => {
        store.overrideSelector(AuthSelectors.getIsNewUser, true);
      });

      it(`dispatches "${AuthAPIActions.signedUp.type}" if fireAuth.createUserWithEmailAndPassword() returns User`, () => {
        const completion = AuthAPIActions.signedUp(signUpExpectedActionPayload);
        createUserWithEmailAndPasswordMock.mockReturnValue(of(signUpCredential));
        actions$ = hot('a', { a: action });
        const expected = hot('b', { b: completion });
        expect(effects.signEmailPassword$).toBeObservable(expected);
        expect(createUserWithEmailAndPasswordMock).toHaveBeenCalledWith(testEmail, testPassword);
      });

      it(`dispatches "${AuthAPIActions.actionFailed.type}" if fireAuth.createUserWithEmailAndPassword() throws an error`, () => {
        const completion = AuthAPIActions.actionFailed({ message: 'Auth failed' });
        createUserWithEmailAndPasswordMock.mockReturnValue(throwError(new Error('Auth failed')));
        actions$ = hot('a', { a: action });
        const expected = hot('b', { b: completion });
        expect(effects.signEmailPassword$).toBeObservable(expected);
        expect(createUserWithEmailAndPasswordMock).toHaveBeenCalledWith(testEmail, testPassword);
      });
    });

    describe(`signIn`, () => {
      beforeEach(() => {
        store.overrideSelector(AuthSelectors.getIsNewUser, false);
      });

      it(`dispatches "${AuthAPIActions.signedIn.type}" if fireAuth.signInWithEmailAndPassword() returns User`, () => {
        const completion = AuthAPIActions.signedIn(mockExpectedActionPayload);
        signInWithEmailAndPasswordMock.mockReturnValue(of(mockAuthCredentials));
        actions$ = hot('a', { a: action });
        const expected = hot('b', { b: completion });
        expect(effects.signEmailPassword$).toBeObservable(expected);
        expect(signInWithEmailAndPasswordMock).toHaveBeenCalledWith(testEmail, testPassword);
      });

      it(`dispatches "${AuthAPIActions.actionFailed.type}" if fireAuth.signInWithEmailAndPassword() throws an error`, () => {
        const completion = AuthAPIActions.actionFailed({ message: 'Auth failed' });
        signInWithEmailAndPasswordMock.mockReturnValue(throwError(new Error('Auth failed')));
        actions$ = hot('a', { a: action });
        const expected = hot('b', { b: completion });
        expect(effects.signEmailPassword$).toBeObservable(expected);
        expect(signInWithEmailAndPasswordMock).toHaveBeenCalledWith(testEmail, testPassword);
      });
    });
  });

  describe('signEmailLink$', () => {
    it(`dispatches "${AuthAPIActions.signEmailLinkRequestSent.type}" if fireAuth.sendSignInLinkToEmail() succeeds`, () => {
      const action = AuthUIActions.signEmailLink();
      const completion = AuthAPIActions.signEmailLinkRequestSent();
      sendSignInLinkToEmailMock.mockReturnValue(of(undefined));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.signEmailLink$).toBeObservable(expected);
      expect(sendSignInLinkToEmailMock).toHaveBeenCalledWith(testEmail, {
        url: `${location.href}?${AUTH_URL_SEGMENT_FOR_LINK_AUTH}=${testEmail}`,
        handleCodeInApp: true,
      });
    });

    it(`dispatches "${AuthAPIActions.actionFailed.type}" if fireAuth.sendSignInLinkToEmail() throws an error`, () => {
      const action = AuthUIActions.signEmailLink();
      const completion = AuthAPIActions.actionFailed({ message: 'Auth failed' });
      sendSignInLinkToEmailMock.mockReturnValue(throwError(new Error('Auth failed')));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.signEmailLink$).toBeObservable(expected);
      expect(sendSignInLinkToEmailMock).toHaveBeenCalledWith(testEmail, {
        url: `${location.href}?${AUTH_URL_SEGMENT_FOR_LINK_AUTH}=${testEmail}`,
        handleCodeInApp: true,
      });
    });
  });

  describe('signEmailLinkFinish$', () => {
    it(`dispatches "${AuthAPIActions.signedIn.type}" if fireAuth.signInWithEmailLink() returns User`, () => {
      const action = AuthAPIActions.signEmailLinkFinish();
      const url = `https://seed.web.app/auth-link?${AUTH_URL_SEGMENT_FOR_LINK_AUTH}=${testEmail}`;
      delete (window as any).location;
      (window.location as any) = new URL(url);
      const completion = AuthAPIActions.signedIn(mockExpectedActionPayload);
      signInWithEmailLinkMock.mockReturnValue(of(mockAuthCredentials));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.signEmailLinkFinish$).toBeObservable(expected);
      expect(signInWithEmailLinkMock).toHaveBeenCalledWith(testEmail, url);
    });

    it(`dispatches "${AuthAPIActions.actionFailed.type}" if no email is provided`, () => {
      const action = AuthAPIActions.signEmailLinkFinish();
      const completion = AuthAPIActions.actionFailed({
        message: 'No email was provided for link authentication. Try again.',
      });
      const url = `https://seed.web.app/auth-link`;
      delete (window as any).location;
      (window.location as any) = new URL(url);
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.signEmailLinkFinish$).toBeObservable(expected);
      expect(signInWithEmailLinkMock).not.toHaveBeenCalledWith();
    });

    it(`dispatches "${AuthAPIActions.actionFailed.type}" if fireAuth.signInWithEmailLink() throws an error`, () => {
      const action = AuthAPIActions.signEmailLinkFinish();
      const completion1 = AuthAPIActions.enterEmail({ email: testEmail });
      const completion2 = AuthAPIActions.actionFailed({ message: 'Auth failed' });
      signInWithEmailLinkMock.mockReturnValue(throwError(new Error('Auth failed')));
      const url = `https://seed.web.app/auth-link?${AUTH_URL_SEGMENT_FOR_LINK_AUTH}=${testEmail}`;
      delete (window as any).location;
      (window.location as any) = new URL(url);
      localStorage[AUTH_REHYDRATION_KEY_EMAIL] = testEmail;
      actions$ = hot('a', { a: action });
      const expected = hot('(bc)', { b: completion1, c: completion2 });
      expect(effects.signEmailLinkFinish$).toBeObservable(expected);
      expect(signInWithEmailLinkMock).toHaveBeenCalledWith(testEmail, url);
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

  describe('hydrateState$', () => {
    // region SETUP
    const localStorageSetItemSpy = jest.spyOn(window.localStorage.__proto__, 'setItem'); // https://stackoverflow.com/a/54157998/9967802
    const localStorageRemoveItemSpy = jest.spyOn(window.localStorage.__proto__, 'removeItem'); // https://stackoverflow.com/a/54157998/9967802
    beforeEach(() => {
      localStorageSetItemSpy.mockReset();
      localStorageRemoveItemSpy.mockReset();
    });

    function actionTest(action: any): void {
      describe(action.type, () => {
        it(`saves state to localStorage when email, display name and photoURL are provided"`, () => {
          const input = action({
            userId: testUserId,
            email: testEmail,
            displayName: testDisplayName,
            photoURL: testPhotoURL,
          });
          actions$ = of(input);
          effects.hydrateState$.subscribe();
          expect(localStorageSetItemSpy).toHaveBeenCalledWith(AUTH_REHYDRATION_KEY_EMAIL, testEmail);
          expect(localStorageSetItemSpy).toHaveBeenCalledWith(AUTH_REHYDRATION_KEY_DISPLAY_NAME, testDisplayName);
          expect(localStorageSetItemSpy).toHaveBeenCalledWith(AUTH_REHYDRATION_KEY_PHOTO_URL, testPhotoURL);
        });

        it(`removes state from localStorage when email, display name and photoURL are not provided`, () => {
          const input = action({
            userId: testUserId,
          });
          actions$ = of(input);
          effects.hydrateState$.subscribe();
          expect(localStorageRemoveItemSpy).toHaveBeenCalledWith(AUTH_REHYDRATION_KEY_EMAIL);
          expect(localStorageRemoveItemSpy).toHaveBeenCalledWith(AUTH_REHYDRATION_KEY_DISPLAY_NAME);
          expect(localStorageRemoveItemSpy).toHaveBeenCalledWith(AUTH_REHYDRATION_KEY_PHOTO_URL);
        });
      });
    }

    // endregion

    actionTest(AuthAPIActions.signedIn);
    actionTest(AuthAPIActions.initSignedIn);
    actionTest(AuthAPIActions.signedUp);
  });

  describe('dehydrateState$', () => {
    // region SETUP
    const localStorageRemoveItemSpy = jest.spyOn(window.localStorage.__proto__, 'removeItem'); // https://stackoverflow.com/a/54157998/9967802
    beforeEach(() => {
      localStorageRemoveItemSpy.mockReset();
    });

    function actionTest(action: Action): void {
      describe(action.type, () => {
        it(`removes state from localStorage`, () => {
          actions$ = of(action);
          effects.dehydrateState$.subscribe();
          expect(localStorageRemoveItemSpy).toHaveBeenCalledWith(AUTH_REHYDRATION_KEY_EMAIL);
          expect(localStorageRemoveItemSpy).toHaveBeenCalledWith(AUTH_REHYDRATION_KEY_DISPLAY_NAME);
          expect(localStorageRemoveItemSpy).toHaveBeenCalledWith(AUTH_REHYDRATION_KEY_PHOTO_URL);
        });
      });
    }

    // endregion

    actionTest(AuthAPIActions.signedOut);
    actionTest(AuthUIActions.changeUser);
  });

  describe('setJWT$', () => {
    it(`dispatches "${AuthAPIActions.setJWT.type}" if when fireAuth.idToken emits null`, () => {
      const completion = AuthAPIActions.setJWT({ jwt: undefined });
      idToken$.next(null);
      const expected = hot('b', { b: completion });
      expect(effects.setJWT$).toBeObservable(expected);
    });

    it(`dispatches "${AuthAPIActions.setJWT.type}" if when fireAuth.idToken emits string`, () => {
      const jwt = 'jwt';
      const completion = AuthAPIActions.setJWT({ jwt });
      idToken$.next(jwt);
      const expected = hot('b', { b: completion });
      expect(effects.setJWT$).toBeObservable(expected);
    });
  });

  describe('onUserAuthenticationWithCredentials()', () => {
    it(`returns "${AuthAPIActions.actionFailed.type}" if not full credential object provided`, () => {
      const result$ = effects.onUserAuthenticationWithCredentials({} as any);
      const expected = hot('(a|)', {
        a: AuthAPIActions.actionFailed({ message: `Credential is not a complete object.` }),
      });
      expect(result$).toBeObservable(expected);
    });

    it(`returns "${AuthAPIActions.signedIn.type}" action for existing user`, () => {
      const isNewUser = false;
      const result$ = effects.onUserAuthenticationWithCredentials({
        user: mockAuthCredentials.user,
        additionalUserInfo: { isNewUser },
      } as any);
      const expected = hot('(a|)', { a: AuthAPIActions.signedIn({ ...mockExpectedActionPayload, isNewUser }) });
      expect(result$).toBeObservable(expected);
    });

    it(`returns "${AuthAPIActions.signedUp.type}" action for just signed up user`, () => {
      const isNewUser = true;
      const result$ = effects.onUserAuthenticationWithCredentials({
        user: mockAuthCredentials.user,
        additionalUserInfo: { isNewUser },
      } as any);
      const expected = hot('(a|)', { a: AuthAPIActions.signedUp({ ...mockExpectedActionPayload, isNewUser }) });
      expect(result$).toBeObservable(expected);
    });
  });

  describe('onUserAuthenticationWithUserOnly()', () => {
    it(`returns "${AuthAPIActions.signedIn.type}" action for existing user`, () => {
      const result$ = effects.onUserAuthenticationWithUserOnly(mockAuthCredentials.user as any, false);
      const expected = hot('(a|)', { a: AuthAPIActions.signedIn(mockExpectedActionPayload) });
      expect(result$).toBeObservable(expected);
    });

    it(`returns "${AuthAPIActions.initSignedIn.type}" action for existing user & init time`, () => {
      const result$ = effects.onUserAuthenticationWithUserOnly(mockAuthCredentials.user as any, false, true);
      const expected = hot('(a|)', { a: AuthAPIActions.initSignedIn(mockExpectedActionPayload) });
      expect(result$).toBeObservable(expected);
    });

    it(`returns "${AuthAPIActions.signedUp.type}" action for just signed up user`, () => {
      const isNewUser = true;
      const result$ = effects.onUserAuthenticationWithUserOnly(mockAuthCredentials.user as any, isNewUser);
      const expected = hot('(a|)', { a: AuthAPIActions.signedUp({ ...mockExpectedActionPayload, isNewUser }) });
      expect(result$).toBeObservable(expected);
    });

    it(`returns "${AuthAPIActions.signedIn.type}" action for just signed up user (but without defined "isNewUser" property)`, () => {
      const creationTime = setMilliseconds(subMinutes(new Date(), 60), 0); // 60 minutes ago
      const result$ = effects.onUserAuthenticationWithUserOnly(
        {
          ...mockAuthCredentials.user,
          ...{ metadata: { creationTime: creationTime.toString() } },
        } as any,
        false,
      );
      const expected = hot('(a|)', {
        a: AuthAPIActions.signedIn({
          ...mockExpectedActionPayload,
          createdAt: creationTime.getTime(),
          isNewUser: false,
        }),
      });
      expect(result$).toBeObservable(expected);
    });

    it(`returns "${AuthAPIActions.signedUp.type}" action for just signed up user (but without defined "isNewUser" property)`, () => {
      const creationTime = subMinutes(setMilliseconds(new Date(), 0), 3); // 3 minutes ago
      const result$ = effects.onUserAuthenticationWithUserOnly(
        {
          ...mockAuthCredentials.user,
          ...{ metadata: { creationTime: creationTime.toString() } },
        } as any,
        true,
      );
      const expected = hot('(a|)', {
        a: AuthAPIActions.signedUp({
          ...mockExpectedActionPayload,
          createdAt: creationTime.getTime(),
          isNewUser: true,
        }),
      });
      expect(result$).toBeObservable(expected);
    });
  });
});
