import { Injectable } from '@angular/core';
import { Actions, concatLatestFrom, createEffect, ofType } from '@ngrx/effects';
import * as AuthUIActions from '../actions/ui.actions';
import * as AuthAPIActions from '../actions/api.actions';
import { AngularFireAuth } from '@angular/fire/auth';
import { catchError, exhaustMap, filter, map, take, tap } from 'rxjs/operators';
import firebase from 'firebase/app';
import { from, merge, Observable, of } from 'rxjs';
import { ONE } from '@seed/shared/constants';
import { Action, Store } from '@ngrx/store';
import * as AuthSelectors from '../auth.selectors';
import { AuthProvider } from '@seed/front/shared/types';
import { RouterSelectors } from '@seed/front/shared/router';

export const AUTH_REHYDRATION_KEY_EMAIL = 'authEmail';
export const AUTH_REHYDRATION_KEY_DISPLAY_NAME = 'authDisplayName';
export const AUTH_REHYDRATION_KEY_PHOTO_URL = 'authPhotoURL';
export const AUTH_URL_SEGMENT_FOR_LINK_AUTH = 'email';
export type FirebaseError = Error & { code?: string };

@Injectable()
export class AuthenticationEffects {
  readonly mapProviders: { [key: string]: AuthProvider } = {
    'google.com': AuthProvider.google,
    'github.com': AuthProvider.github,
    password: AuthProvider.password,
    emailLink: AuthProvider.link,
  };

  init$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthAPIActions.init),
      exhaustMap(() =>
        this.fireAuth.user.pipe(
          take(ONE),
          exhaustMap(user => {
            if (user) {
              return from(this.onUserAuthenticationWithUserOnly(user, false, true));
            }
            return from(this.fireAuth.isSignInWithEmailLink(window.location.href)).pipe(
              map(isSignInWithEmailLink => {
                if (isSignInWithEmailLink) {
                  return AuthAPIActions.signEmailLinkFinish();
                }
                const email = localStorage.getItem(AUTH_REHYDRATION_KEY_EMAIL) || undefined;
                if (email) {
                  const displayName = localStorage.getItem(AUTH_REHYDRATION_KEY_DISPLAY_NAME) || undefined;
                  const photoURL = localStorage.getItem(AUTH_REHYDRATION_KEY_PHOTO_URL) || undefined;
                  return AuthAPIActions.initNotAuthenticatedButRehydrateState({ email, displayName, photoURL });
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

  saveOriginalURL$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthAPIActions.init),
      concatLatestFrom(() => this.store.select(RouterSelectors.getUrl)),
      map(([, url]) => {
        return AuthAPIActions.saveOriginalURL({ url });
      }),
    ),
  );

  enterEmail$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthUIActions.enterEmail, AuthAPIActions.initNotAuthenticatedButRehydrateState),
      tap(({ email }) => localStorage.setItem(AUTH_REHYDRATION_KEY_EMAIL, email)),
      map(() => AuthAPIActions.fetchProviders()),
    ),
  );

  selectProvider$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthUIActions.selectProvider),
      map(({ provider }) => {
        switch (provider) {
          case AuthProvider.google:
            return AuthUIActions.signGoogle();
          case AuthProvider.github:
            return AuthUIActions.signGitHub();
          case AuthProvider.link:
            return AuthUIActions.signEmailLink();
          case AuthProvider.anonymous:
            return AuthUIActions.signAnonymously();
          default:
            return { type: 'noop' };
        }
      }),
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

  hydrateState$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(AuthAPIActions.signedIn, AuthAPIActions.initSignedIn, AuthAPIActions.signedUp),
        tap(action => {
          if (action.email) {
            localStorage.setItem(AUTH_REHYDRATION_KEY_EMAIL, action.email);
          } else {
            localStorage.removeItem(AUTH_REHYDRATION_KEY_EMAIL);
          }

          if (action.displayName) {
            localStorage.setItem(AUTH_REHYDRATION_KEY_DISPLAY_NAME, action.displayName);
          } else {
            localStorage.removeItem(AUTH_REHYDRATION_KEY_DISPLAY_NAME);
          }

          if (action.photoURL) {
            localStorage.setItem(AUTH_REHYDRATION_KEY_PHOTO_URL, action.photoURL);
          } else {
            localStorage.removeItem(AUTH_REHYDRATION_KEY_PHOTO_URL);
          }
        }),
      ),
    { dispatch: false },
  );

  dehydrateState$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(AuthAPIActions.signedOut, AuthUIActions.changeUser),
        tap(() => {
          localStorage.removeItem(AUTH_REHYDRATION_KEY_EMAIL);
          localStorage.removeItem(AUTH_REHYDRATION_KEY_DISPLAY_NAME);
          localStorage.removeItem(AUTH_REHYDRATION_KEY_PHOTO_URL);
        }),
      ),
    { dispatch: false },
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
            const mappedProviders = providers.map(p => this.mapProviders[p]);
            return AuthAPIActions.fetchProvidersSuccess({ providers: mappedProviders });
          }),
          catchError((error: FirebaseError) =>
            of(AuthAPIActions.actionFailed({ message: error.message, code: error.code })),
          ),
        ),
      ),
    ),
  );

  signAnonymously$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthUIActions.signAnonymously),
      exhaustMap(() =>
        from(this.fireAuth.signInAnonymously()).pipe(
          exhaustMap(credential => this.onUserAuthenticationWithCredentials(credential)),
          catchError((error: FirebaseError) =>
            of(AuthAPIActions.actionFailed({ message: error.message, code: error.code })),
          ),
        ),
      ),
    ),
  );

  signGoogle$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthUIActions.signGoogle),
      exhaustMap(() =>
        from(this.fireAuth.signInWithPopup(new firebase.auth.GoogleAuthProvider())).pipe(
          exhaustMap(credential => this.onUserAuthenticationWithCredentials(credential)),
          catchError((error: FirebaseError) =>
            of(AuthAPIActions.actionFailed({ message: error.message, code: error.code })),
          ),
        ),
      ),
    ),
  );

  signGitHub$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthUIActions.signGitHub),
      exhaustMap(() =>
        from(this.fireAuth.signInWithPopup(new firebase.auth.GithubAuthProvider())).pipe(
          exhaustMap(credential => this.onUserAuthenticationWithCredentials(credential)),
          catchError((error: FirebaseError) =>
            of(AuthAPIActions.actionFailed({ message: error.message, code: error.code })),
          ),
        ),
      ),
    ),
  );

  signEmailPassword$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthUIActions.signEmailPassword),
      concatLatestFrom(() => this.store.select(AuthSelectors.getEmailPasswordPayload)),
      exhaustMap(([action, { email, isNewUser }]) =>
        from(
          isNewUser
            ? this.fireAuth.createUserWithEmailAndPassword(email, action.password)
            : this.fireAuth.signInWithEmailAndPassword(email, action.password),
        ).pipe(
          exhaustMap(credential => this.onUserAuthenticationWithCredentials(credential)),
          catchError((error: FirebaseError) =>
            of(AuthAPIActions.actionFailed({ message: error.message, code: error.code })),
          ),
        ),
      ),
    ),
  );

  signEmailLink$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthUIActions.signEmailLink),
      concatLatestFrom(() =>
        this.store.select(AuthSelectors.getEmail).pipe(filter((email): email is string => !!email)),
      ),
      exhaustMap(([, email]) =>
        from(
          this.fireAuth.sendSignInLinkToEmail(email, {
            url: `${location.href}?${AUTH_URL_SEGMENT_FOR_LINK_AUTH}=${email}`,
            handleCodeInApp: true,
          }),
        ).pipe(
          map(() => AuthAPIActions.signEmailLinkRequestSent()),
          catchError((error: FirebaseError) =>
            of(AuthAPIActions.actionFailed({ message: error.message, code: error.code })),
          ),
        ),
      ),
    ),
  );

  signEmailLinkFinish$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthAPIActions.signEmailLinkFinish),
      exhaustMap(() => {
        const email = new URL(location.href).searchParams.get(AUTH_URL_SEGMENT_FOR_LINK_AUTH);
        if (!email) {
          const errorMessage = 'No email was provided for link authentication. Try again.';
          return of(AuthAPIActions.actionFailed({ message: errorMessage }));
        }

        return from(this.fireAuth.signInWithEmailLink(email, window.location.href)).pipe(
          exhaustMap(credential => this.onUserAuthenticationWithCredentials(credential)),
          catchError((error: FirebaseError) =>
            merge(
              of(AuthAPIActions.enterEmail({ email })),
              of(AuthAPIActions.actionFailed({ message: error.message, code: error.code })),
            ),
          ),
        );
      }),
    ),
  );

  setJWT$ = createEffect(() =>
    this.fireAuth.idToken.pipe(map(jwt => AuthAPIActions.setJWT({ jwt: jwt ?? undefined }))),
  );

  constructor(readonly actions$: Actions, readonly fireAuth: AngularFireAuth, readonly store: Store) {}

  onUserAuthenticationWithCredentials = (credential: firebase.auth.UserCredential): Observable<Action> => {
    if (!credential.additionalUserInfo || !credential.user) {
      return of(AuthAPIActions.actionFailed({ message: `Credential is not a complete object.` }));
    }
    const { isNewUser } = credential.additionalUserInfo;
    return this.onUserAuthenticationWithUserOnly(credential.user, isNewUser);
  };

  onUserAuthenticationWithUserOnly = (
    user: firebase.User,
    isNewUser: boolean,
    isInit?: boolean,
  ): Observable<Action> => {
    const { uid: userId, email, displayName, photoURL, emailVerified, metadata, providerData } = user;
    const createdAt: number = metadata.creationTime ? Date.parse(metadata.creationTime) : new Date().getTime();

    return from(user.getIdToken()).pipe(
      map(jwt => {
        const authenticationData = {
          userId,
          email: email || undefined,
          displayName: displayName || undefined,
          photoURL: photoURL || undefined,
          isEmailVerified: emailVerified,
          createdAt,
          isNewUser,
          providers: providerData
            .filter((pd): pd is firebase.UserInfo => pd !== null)
            .map(pd => this.mapProviders[pd.providerId]),
          jwt,
        };

        if (isNewUser) {
          return AuthAPIActions.signedUp(authenticationData);
        }
        if (isInit) {
          return AuthAPIActions.initSignedIn(authenticationData);
        }
        return AuthAPIActions.signedIn(authenticationData);
      }),
    );
  };
}
