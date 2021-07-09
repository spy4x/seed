import { TestBed } from '@angular/core/testing';
import { Observable, of, ReplaySubject, throwError } from 'rxjs';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { AuthEffects } from './auth.effects';
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
            signOut: signOutMock,
          },
        },
      ],
    });
    effects = TestBed.inject(AuthEffects);
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
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.init$).toBeObservable(expected);
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
      const action = AuthActions.authenticateWithEmailAndPassword({ email: testEmail, password: 'test1234' });
      const completion = AuthActions.authenticationFailed({ errorMessage: 'Auth failed' });
      signInWithEmailAndPasswordMock.mockReturnValue(throwError(new Error('Auth failed')));
      actions$ = hot('a', { a: action });
      const expected = hot('b', { b: completion });
      expect(effects.authenticateWithEmailAndPassword$).toBeObservable(expected);
      expect(signInWithEmailAndPasswordMock).toHaveBeenCalledWith(testEmail, testPassword);
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
      const action = AuthActions.signUpWithEmailAndPassword({ email: testEmail, password: 'test1234' });
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
