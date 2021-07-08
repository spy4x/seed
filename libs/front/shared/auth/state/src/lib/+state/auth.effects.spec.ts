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

describe(AuthEffects.name, () => {
  let actions$ = new Observable<Action>();
  let effects: AuthEffects;
  let user$: ReplaySubject<null | { uid: string }>;
  const signInAnonymouslyMock = jest.fn();
  const signInWithPopupMock = jest.fn();
  const signOutMock = jest.fn();

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
            signOut: signOutMock,
          },
        },
      ],
    });
    effects = TestBed.inject(AuthEffects);
  });

  it('init$ success', () => {
    const action = AuthActions.init();
    const completion = AuthActions.authenticatedAfterInit({ userId: '123' });
    user$.next({ uid: '123' });
    actions$ = hot('a', { a: action });
    const expected = hot('b', { b: completion });
    expect(effects.init$).toBeObservable(expected);
  });

  it('init$ fail', () => {
    const action = AuthActions.init();
    const completion = AuthActions.notAuthenticated();
    user$.next(null);
    actions$ = hot('a', { a: action });
    const expected = hot('b', { b: completion });
    expect(effects.init$).toBeObservable(expected);
  });

  it('authenticateAnonymously$ success', () => {
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

  it('authenticateAnonymously$ fail', () => {
    const action = AuthActions.authenticateAnonymously();
    const completion = AuthActions.authenticationFailed({ errorMessage: 'Auth failed' });
    signInAnonymouslyMock.mockReturnValue(throwError(new Error('Auth failed')));
    actions$ = hot('a', { a: action });
    const expected = hot('b', { b: completion });
    expect(effects.authenticateAnonymously$).toBeObservable(expected);
    expect(signInAnonymouslyMock).toHaveBeenCalled();
  });

  it('authenticateWithGoogle$ success', () => {
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

  it('authenticateWithGoogle$ fail', () => {
    const action = AuthActions.authenticateWithGoogle();
    const completion = AuthActions.authenticationFailed({ errorMessage: 'Auth failed' });
    signInWithPopupMock.mockReturnValue(throwError(new Error('Auth failed')));
    actions$ = hot('a', { a: action });
    const expected = hot('b', { b: completion });
    expect(effects.authenticateWithGoogle$).toBeObservable(expected);
    expect(signInWithPopupMock).toHaveBeenCalledWith(new firebase.auth.GoogleAuthProvider());
  });

  it('authenticateWithGitHub$ success', () => {
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

  it('authenticateWithGitHub$ fail', () => {
    const action = AuthActions.authenticateWithGitHub();
    const completion = AuthActions.authenticationFailed({ errorMessage: 'Auth failed' });
    signInWithPopupMock.mockReturnValue(throwError(new Error('Auth failed')));
    actions$ = hot('a', { a: action });
    const expected = hot('b', { b: completion });
    expect(effects.authenticateWithGitHub$).toBeObservable(expected);
    expect(signInWithPopupMock).toHaveBeenCalledWith(new firebase.auth.GithubAuthProvider());
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
});
