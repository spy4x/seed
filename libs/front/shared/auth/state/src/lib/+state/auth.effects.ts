import { Injectable } from '@angular/core';
import { Actions, concatLatestFrom, createEffect, ofType } from '@ngrx/effects';

import * as AuthUIActions from './actions/ui.actions';
import * as AuthAPIActions from './actions/api.actions';
import { AngularFireAuth } from '@angular/fire/auth';
import { catchError, exhaustMap, filter, map, take, tap } from 'rxjs/operators';
import firebase from 'firebase/app';
import { from, of } from 'rxjs';
import { ONE } from '@seed/shared/constants';
import { Store } from '@ngrx/store';
import * as AuthSelectors from './auth.selectors';
import { AuthProvider } from '@seed/front/shared/types';

export const AUTH_EFFECTS_EMAIL_LINK_LOCAL_STORAGE_KEY = 'emailForLinkAuth';
export type FirebaseError = Error & { code?: string };

@Injectable()
export class AuthEffects {
  init$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthAPIActions.init),
      exhaustMap(() =>
        this.fireAuth.user.pipe(
          take(ONE),
          exhaustMap(user => {
            if (user) {
              return of(AuthAPIActions.initAuthenticated({ userId: user.uid }));
            }
            return from(this.fireAuth.isSignInWithEmailLink(window.location.href)).pipe(
              map(isSignInWithEmailLink => {
                if (isSignInWithEmailLink) {
                  return AuthAPIActions.authenticateWithEmailLinkFinish();
                }
                return AuthAPIActions.initNotAuthenticated();
              }),
              catchError((error: FirebaseError) =>
                of(AuthAPIActions.actionFailed({ message: error.message, code: error.code })),
              ),
            );
          }),
        ),
      ),
    ),
  );

  enterEmail$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthUIActions.enterEmail),
      map(() => AuthAPIActions.fetchProviders()),
    ),
  );

  fetchProviders$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthAPIActions.fetchProviders),
      concatLatestFrom(() =>
        this.store.select(AuthSelectors.getEmail).pipe(filter((email): email is string => !!email)),
      ),
      exhaustMap(([, email]) =>
        from(this.fireAuth.fetchSignInMethodsForEmail(email)).pipe(
          map(providers => {
            console.log({ providers });
            const map: { [key: string]: AuthProvider } = {
              'google.com': AuthProvider.google,
              password: AuthProvider.password,
              emailLink: AuthProvider.link,
            };
            const mappedProviders = providers.map(p => map[p]);
            console.log({ mappedProviders });
            return AuthAPIActions.fetchProvidersSuccess({ providers: mappedProviders });
          }),
          catchError((error: FirebaseError) =>
            of(AuthAPIActions.actionFailed({ message: error.message, code: error.code })),
          ),
        ),
      ),
    ),
  );
  fetchProvidersSuccess$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthAPIActions.fetchProvidersSuccess),
      // concatLatestFrom(() =>
      //   this.store.select(AuthSelectors.getEmail).pipe(filter((email): email is string => !!email)),
      // ),
      // exhaustMap(([, email]) =>
      //   from(this.fireAuth.fetchSignInMethodsForEmail(email)).pipe(
      //     map(providers => {
      //       console.log({ providers });
      //       const map: { [key: string]: AuthProvider } = {
      //         'google.com': AuthProvider.google,
      //         password: AuthProvider.password,
      //         emailLink: AuthProvider.link,
      //       };
      //       const mappedProviders = providers.map(p => map[p]);
      //       console.log({ mappedProviders });
      //       return AuthAPIActions.fetchProvidersSuccess({ providers: mappedProviders });
      //     }),
      //     catchError((error: FirebaseError) =>
      //       of(AuthAPIActions.actionFailed({ message: error.message, code: error.code })),
      //     ),
      //   ),
      // ),
    ),
  );

  chooseProvider$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthUIActions.chooseProvider),
      map(({ provider }) => {
        switch (provider) {
          case AuthProvider.google:
            return AuthUIActions.authenticateWithGoogle();
          case AuthProvider.github:
            return AuthUIActions.authenticateWithGitHub();
          case AuthProvider.link:
            return AuthUIActions.authenticateWithEmailLink();
          case AuthProvider.anonymous:
            return AuthUIActions.signUpAnonymously();
          default:
            return { type: 'noop' };
        }
      }),
    ),
  );

  signUpAnonymously$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthUIActions.signUpAnonymously),
      exhaustMap(() =>
        from(this.fireAuth.signInAnonymously()).pipe(
          map(credential => {
            if (!credential.user) {
              throw new Error('User is not defined.');
            }
            return AuthAPIActions.authenticated({ userId: credential.user.uid });
          }),
          catchError((error: FirebaseError) =>
            of(AuthAPIActions.actionFailed({ message: error.message, code: error.code })),
          ),
        ),
      ),
    ),
  );

  authenticateWithGoogle$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthUIActions.authenticateWithGoogle),
      exhaustMap(() =>
        from(this.fireAuth.signInWithPopup(new firebase.auth.GoogleAuthProvider())).pipe(
          map(credential => {
            if (!credential.user) {
              throw new Error('User is not defined.');
            }
            return AuthAPIActions.authenticated({ userId: credential.user.uid });
          }),
          catchError((error: FirebaseError) =>
            of(AuthAPIActions.actionFailed({ message: error.message, code: error.code })),
          ),
        ),
      ),
    ),
  );

  authenticateWithGitHub$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthUIActions.authenticateWithGitHub),
      exhaustMap(() =>
        from(this.fireAuth.signInWithPopup(new firebase.auth.GithubAuthProvider())).pipe(
          map(credential => {
            if (!credential.user) {
              throw new Error('User is not defined.');
            }
            return AuthAPIActions.authenticated({ userId: credential.user.uid });
          }),
          catchError((error: FirebaseError) =>
            of(AuthAPIActions.actionFailed({ message: error.message, code: error.code })),
          ),
        ),
      ),
    ),
  );

  signInWithEmailAndPassword$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthUIActions.signInWithEmailAndPassword),
      concatLatestFrom(() =>
        this.store.select(AuthSelectors.getEmail).pipe(filter((email): email is string => !!email)),
      ),
      exhaustMap(([action, email]) =>
        from(this.fireAuth.signInWithEmailAndPassword(email, action.password)).pipe(
          map(credential => {
            if (!credential.user) {
              throw new Error('User is not defined.');
            }
            return AuthAPIActions.authenticated({ userId: credential.user.uid });
          }),
          catchError((error: FirebaseError) =>
            of(AuthAPIActions.actionFailed({ message: error.message, code: error.code })),
          ),
        ),
      ),
    ),
  );

  authenticateWithEmailLink$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthUIActions.authenticateWithEmailLink),
      concatLatestFrom(() =>
        this.store.select(AuthSelectors.getEmail).pipe(filter((email): email is string => !!email)),
      ),
      exhaustMap(([, email]) =>
        from(this.fireAuth.sendSignInLinkToEmail(email, { url: location.href, handleCodeInApp: true })).pipe(
          map(() => AuthAPIActions.authenticateWithEmailLinkRequestSent()),
          tap(() => (localStorage[AUTH_EFFECTS_EMAIL_LINK_LOCAL_STORAGE_KEY] = email)),
          catchError((error: FirebaseError) =>
            of(AuthAPIActions.actionFailed({ message: error.message, code: error.code })),
          ),
        ),
      ),
    ),
  );

  authenticateWithEmailLinkFinish$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthAPIActions.authenticateWithEmailLinkFinish),
      exhaustMap(() => {
        // TODO: use URL ?email param instead of localstorage
        // var actionCodeSettings = {
        //   url: 'localhost/?email=user@example.com',
        // }
        const email = localStorage[AUTH_EFFECTS_EMAIL_LINK_LOCAL_STORAGE_KEY] as string;
        if (!email || email === 'undefined') {
          const errorMessage = 'No email was provided for link authentication. Try again.';
          return of(AuthAPIActions.actionFailed({ message: errorMessage }));
        }

        return from(this.fireAuth.signInWithEmailLink(email, window.location.href)).pipe(
          map(credential => {
            if (!credential.user) {
              throw new Error('User is not defined.');
            }
            return AuthAPIActions.authenticated({ userId: credential.user.uid });
          }),
          catchError((error: FirebaseError) =>
            of(AuthAPIActions.actionFailed({ message: error.message, code: error.code })),
          ),
        );
      }),
    ),
  );

  signUpWithEmailAndPassword$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthUIActions.signUpWithEmailAndPassword),
      concatLatestFrom(() =>
        this.store.select(AuthSelectors.getEmail).pipe(filter((email): email is string => !!email)),
      ),
      exhaustMap(([action, email]) =>
        from(this.fireAuth.createUserWithEmailAndPassword(email, action.password)).pipe(
          map(credential => {
            if (!credential.user) {
              throw new Error('User is not defined.');
            }
            return AuthAPIActions.signedUp({ userId: credential.user.uid });
          }),
          catchError((error: FirebaseError) =>
            of(AuthAPIActions.actionFailed({ message: error.message, code: error.code })),
          ),
        ),
      ),
    ),
  );

  restorePassword$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthUIActions.restorePassword),
      concatLatestFrom(() =>
        this.store.select(AuthSelectors.getEmail).pipe(filter((email): email is string => !!email)),
      ),
      exhaustMap(([, email]) =>
        from(this.fireAuth.sendPasswordResetEmail(email)).pipe(
          map(() => AuthAPIActions.restorePasswordSuccess()),
          catchError((error: FirebaseError) =>
            of(AuthAPIActions.actionFailed({ message: error.message, code: error.code })),
          ),
        ),
      ),
    ),
  );

  signOut$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthUIActions.signOut),
      exhaustMap(() => from(this.fireAuth.signOut()).pipe(map(() => AuthAPIActions.signedOut()))),
    ),
  );

  constructor(readonly actions$: Actions, readonly fireAuth: AngularFireAuth, readonly store: Store) {}
}
