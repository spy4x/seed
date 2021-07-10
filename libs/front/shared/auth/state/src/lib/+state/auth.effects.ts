import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';

import * as AuthActions from './auth.actions';
import { AngularFireAuth } from '@angular/fire/auth';
import { catchError, exhaustMap, map, take, tap } from 'rxjs/operators';
import firebase from 'firebase/app';
import { from, of } from 'rxjs';
import { ONE } from '@seed/shared/constants';

export const AUTH_EFFECTS_EMAIL_LINK_LOCAL_STORAGE_KEY = 'emailForLinkAuth';

@Injectable()
export class AuthEffects {
  init$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.init),
      exhaustMap(() =>
        this.fireAuth.user.pipe(
          take(ONE),
          exhaustMap(user => {
            if (user) {
              return of(AuthActions.authenticatedAfterInit({ userId: user.uid }));
            }
            return from(this.fireAuth.isSignInWithEmailLink(window.location.href)).pipe(
              map(isSignInWithEmailLink => {
                if (isSignInWithEmailLink) {
                  return AuthActions.authenticateWithEmailLinkFinish();
                }
                return AuthActions.notAuthenticated();
              }),
              catchError((error: Error) => of(AuthActions.authenticationFailed({ errorMessage: error.message }))),
            );
          }),
        ),
      ),
    ),
  );

  authenticateAnonymously$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.authenticateAnonymously),
      exhaustMap(() =>
        from(this.fireAuth.signInAnonymously()).pipe(
          map(credential => {
            if (!credential.user) {
              throw new Error('User is not defined.');
            }
            return AuthActions.authenticatedAfterUserAction({ userId: credential.user.uid });
          }),
          catchError((error: Error) => of(AuthActions.authenticationFailed({ errorMessage: error.message }))),
        ),
      ),
    ),
  );

  authenticateWithGoogle$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.authenticateWithGoogle),
      exhaustMap(() =>
        from(this.fireAuth.signInWithPopup(new firebase.auth.GoogleAuthProvider())).pipe(
          map(credential => {
            if (!credential.user) {
              throw new Error('User is not defined.');
            }
            return AuthActions.authenticatedAfterUserAction({ userId: credential.user.uid });
          }),
          catchError((error: Error) => of(AuthActions.authenticationFailed({ errorMessage: error.message }))),
        ),
      ),
    ),
  );

  authenticateWithGitHub$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.authenticateWithGitHub),
      exhaustMap(() =>
        from(this.fireAuth.signInWithPopup(new firebase.auth.GithubAuthProvider())).pipe(
          map(credential => {
            if (!credential.user) {
              throw new Error('User is not defined.');
            }
            return AuthActions.authenticatedAfterUserAction({ userId: credential.user.uid });
          }),
          catchError((error: Error) => of(AuthActions.authenticationFailed({ errorMessage: error.message }))),
        ),
      ),
    ),
  );

  authenticateWithEmailAndPassword$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.authenticateWithEmailAndPassword),
      exhaustMap(action =>
        from(this.fireAuth.signInWithEmailAndPassword(action.email, action.password)).pipe(
          map(credential => {
            if (!credential.user) {
              throw new Error('User is not defined.');
            }
            return AuthActions.authenticatedAfterUserAction({ userId: credential.user.uid });
          }),
          catchError((error: Error) => of(AuthActions.authenticationFailed({ errorMessage: error.message }))),
        ),
      ),
    ),
  );

  authenticateWithEmailLink$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.authenticateWithEmailLink),
      exhaustMap(action =>
        from(this.fireAuth.sendSignInLinkToEmail(action.email, { url: location.href, handleCodeInApp: true })).pipe(
          map(() => AuthActions.authenticateWithEmailLinkRequestSent()),
          tap(() => (localStorage[AUTH_EFFECTS_EMAIL_LINK_LOCAL_STORAGE_KEY] = action.email)),
          catchError((error: Error) => of(AuthActions.authenticationFailed({ errorMessage: error.message }))),
        ),
      ),
    ),
  );

  authenticateWithEmailLinkFinish$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.authenticateWithEmailLinkFinish),
      exhaustMap(() => {
        const email = localStorage[AUTH_EFFECTS_EMAIL_LINK_LOCAL_STORAGE_KEY] as string;
        if (!email || email === 'undefined') {
          const errorMessage = 'No email was provided for link authentication. Try again.';
          return of(AuthActions.authenticationFailed({ errorMessage }));
        }

        return from(this.fireAuth.signInWithEmailLink(email, window.location.href)).pipe(
          map(credential => {
            if (!credential.user) {
              throw new Error('User is not defined.');
            }
            return AuthActions.authenticatedAfterUserAction({ userId: credential.user.uid });
          }),
          catchError((error: Error) => of(AuthActions.authenticationFailed({ errorMessage: error.message }))),
        );
      }),
    ),
  );

  signUpWithEmailAndPassword$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.signUpWithEmailAndPassword),
      exhaustMap(action =>
        from(this.fireAuth.createUserWithEmailAndPassword(action.email, action.password)).pipe(
          map(credential => {
            if (!credential.user) {
              throw new Error('User is not defined.');
            }
            return AuthActions.signedUp({ userId: credential.user.uid });
          }),
          catchError((error: Error) => of(AuthActions.authenticationFailed({ errorMessage: error.message }))),
        ),
      ),
    ),
  );

  restorePassword$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.restorePasswordAttempt),
      exhaustMap(action =>
        from(this.fireAuth.sendPasswordResetEmail(action.email)).pipe(
          map(() => AuthActions.restorePasswordRequestSent()),
          catchError((error: Error) => of(AuthActions.authenticationFailed({ errorMessage: error.message }))),
        ),
      ),
    ),
  );

  signOut$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.signOut),
      exhaustMap(() => from(this.fireAuth.signOut()).pipe(map(() => AuthActions.signedOut()))),
    ),
  );

  constructor(readonly actions$: Actions, readonly fireAuth: AngularFireAuth) {}
}
