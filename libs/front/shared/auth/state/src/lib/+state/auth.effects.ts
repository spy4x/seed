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

  authenticate$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(AuthActions.authenticateAnonymously),
        exhaustMap(() => this.fireAuth.signInAnonymously()),
      ),
    { dispatch: false },
  );

  signOut$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(AuthActions.signOut),
        exhaustMap(() => this.fireAuth.signOut()),
      ),
    { dispatch: false },
  );

  constructor(private actions$: Actions, private fireAuth: AngularFireAuth) {}
}
