import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';

import * as AuthActions from './auth.actions';
import { AngularFireAuth } from '@angular/fire/auth';
import { exhaustMap, map } from 'rxjs/operators';

@Injectable()
export class AuthEffects {
  authenticatedStateSub$ = createEffect(() =>
    this.fireAuth.user.pipe(
      map(user => (user ? AuthActions.authenticated({ userId: user.uid }) : AuthActions.notAuthenticated())),
    ),
  );

  authenticateAnonymously$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(AuthActions.authenticateAnonymously),
        exhaustMap(async () => this.fireAuth.signInAnonymously()),
      ),
    { dispatch: false },
  );

  signOut$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(AuthActions.signOut),
        exhaustMap(async () => this.fireAuth.signOut()),
      ),
    { dispatch: false },
  );

  constructor(readonly actions$: Actions, readonly fireAuth: AngularFireAuth) {}
}
