import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';

import * as AuthActions from './auth.actions';
import { AngularFireAuth } from '@angular/fire/auth';
import { catchError, exhaustMap, map, take } from 'rxjs/operators';
import firebase from 'firebase/app';
import { from, of } from 'rxjs';
import { ONE } from '@seed/shared/constants';

@Injectable()
export class AuthEffects {
  init$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.init),
      exhaustMap(() =>
        this.fireAuth.user.pipe(
          take(ONE),
          map(user =>
            user ? AuthActions.authenticatedAfterInit({ userId: user.uid }) : AuthActions.notAuthenticated(),
          ),
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

  signOut$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.signOut),
      exhaustMap(() => from(this.fireAuth.signOut()).pipe(map(() => AuthActions.signedOut()))),
    ),
  );

  constructor(readonly actions$: Actions, readonly fireAuth: AngularFireAuth) {}
}
