import { Inject, Injectable } from '@angular/core';
import { Actions, concatLatestFrom, createEffect, ofType } from '@ngrx/effects';
import * as AuthUIActions from '../actions/ui.actions';
import * as AuthAPIActions from '../actions/api.actions';
import { catchError, exhaustMap, map, tap } from 'rxjs/operators';
import { Router } from '@angular/router';
import {
  AUTH_ROUTE_URL_FOR_AUTHENTICATION_PAGE_TOKEN,
  AUTH_ROUTE_URL_FOR_AUTHORIZED_PAGE_TOKEN,
  AUTH_ROUTE_URL_FOR_CREATING_PROFILE_TOKEN,
} from '../../routeURLs';
import { from, of } from 'rxjs';
import { UserService } from '../../userService/user.service';
import { AUTH_IS_AUTHORIZED_HANDLER_TOKEN, IsAuthorizedHandler } from '../../isAuthorized';
import * as AuthSelectors from '../auth.selectors';
import { Store } from '@ngrx/store';

@Injectable()
export class AuthorizationEffects {
  profileLoad$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthAPIActions.signedIn, AuthAPIActions.initSignedIn),
      exhaustMap(() =>
        this.userService.getMe().pipe(
          map(user =>
            user ? AuthAPIActions.profileLoadSuccess({ user }) : AuthAPIActions.profileLoadSuccessNoProfileYet(),
          ),
          catchError((error: Error) => of(AuthAPIActions.actionFailed({ message: error.message }))),
        ),
      ),
    ),
  );

  redirectToCreateProfile$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(AuthAPIActions.signedUp, AuthAPIActions.profileLoadSuccessNoProfileYet),
        concatLatestFrom(() => this.store.select(AuthSelectors.getOriginalUrl)),
        exhaustMap(([, originalURL]) => {
          if (this.createProfileURL === originalURL) {
            return of(null);
          }
          return from(this.router.navigateByUrl(this.createProfileURL)).pipe(
            tap(
              hasNavigated =>
                !hasNavigated &&
                // eslint-disable-next-line no-console
                console.error(`redirectToCreateProfile$ failed to navigate to "${this.createProfileURL}"`),
            ),
            catchError(error => {
              // eslint-disable-next-line no-console
              console.error(`redirectToCreateProfile$`, error);
              return of(null);
            }),
          );
        }),
      ),
    { dispatch: false },
  );

  profileCreate$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthUIActions.profileCreate),
      exhaustMap(action =>
        this.userService.create(action.user).pipe(
          map(createdProfile => AuthAPIActions.profileCreateSuccess({ user: createdProfile })),
          catchError((error: Error) => of(AuthAPIActions.actionFailed({ message: error.message }))),
        ),
      ),
    ),
  );

  authorize$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthAPIActions.profileCreateSuccess, AuthAPIActions.profileLoadSuccess),
      exhaustMap(action =>
        from(this.isAuthorizedHandler(action.user)).pipe(
          map(isAuthorizedOrReason =>
            isAuthorizedOrReason === true
              ? AuthAPIActions.authorized()
              : AuthAPIActions.notAuthorized({ reason: isAuthorizedOrReason }),
          ),
          catchError((error: Error) => of(AuthAPIActions.actionFailed({ message: error.message }))),
        ),
      ),
    ),
  );

  redirectToAuthorizedPage$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(AuthAPIActions.authorized),
        concatLatestFrom(() => this.store.select(AuthSelectors.getOriginalUrl)),
        exhaustMap(([, originalURL]) => {
          let redirectToURL = this.authorizedURL;
          if (originalURL && originalURL !== '/' && !originalURL.startsWith(this.authenticationURL)) {
            redirectToURL = originalURL;
          }
          return from(this.router.navigateByUrl(redirectToURL)).pipe(
            tap(
              hasNavigated =>
                // eslint-disable-next-line no-console
                !hasNavigated && console.error(`redirectToAuthorizedPage$ failed to navigate to "${redirectToURL}"`),
            ),
            catchError(error => {
              // eslint-disable-next-line no-console
              console.error(`redirectToAuthorizedPage$`, error);
              return of(null);
            }),
          );
        }),
      ),
    { dispatch: false },
  );

  redirectToNotAuthorizedPage$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(AuthAPIActions.notAuthorized, AuthAPIActions.signedOut),
        exhaustMap(() =>
          from(this.router.navigateByUrl(this.authenticationURL)).pipe(
            tap(
              hasNavigated =>
                !hasNavigated &&
                // eslint-disable-next-line no-console
                console.error(`redirectToNotAuthorizedPage$ failed to navigate to "${this.authenticationURL}"`),
            ),
            catchError(error => {
              // eslint-disable-next-line no-console
              console.error(`redirectToNotAuthorizedPage$`, error);
              return of(null);
            }),
          ),
        ),
      ),
    { dispatch: false },
  );

  constructor(
    readonly actions$: Actions,
    readonly store: Store,
    readonly router: Router,
    readonly userService: UserService,
    @Inject(AUTH_ROUTE_URL_FOR_AUTHENTICATION_PAGE_TOKEN) readonly authenticationURL: string,
    @Inject(AUTH_ROUTE_URL_FOR_CREATING_PROFILE_TOKEN) readonly createProfileURL: string,
    @Inject(AUTH_ROUTE_URL_FOR_AUTHORIZED_PAGE_TOKEN) readonly authorizedURL: string,
    @Inject(AUTH_IS_AUTHORIZED_HANDLER_TOKEN) readonly isAuthorizedHandler: IsAuthorizedHandler,
  ) {}
}
