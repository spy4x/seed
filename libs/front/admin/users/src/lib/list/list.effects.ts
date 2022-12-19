import { Injectable } from '@angular/core';
import { Actions, concatLatestFrom, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { UsersActions, UsersSelectors } from './list.state';
import { UserService } from '@seed/front/shared/auth/state';
import { Store } from '@ngrx/store';
// import { routerNavigatedAction } from '@ngrx/router-store';
// import { ONE } from '@seed/shared/constants';

@Injectable()
export class UsersEffects {
  loadUsers$ = createEffect(() =>
    this.actions$.pipe(
      ofType(UsersActions.load),
      concatLatestFrom(() => [this.store.select(UsersSelectors.state)]),
      switchMap(([, state]) =>
        this.usersService.find(state.page, state.limit, state.filter).pipe(
          map(res => UsersActions.loadSuccess({ entities: res.data, total: res.total })),
          catchError((error: Error) => of(UsersActions.loadFail({ message: error.message }))),
        ),
      ),
    ),
  );
  //
  // routeParams$ = createEffect(() =>
  //   this.actions$.pipe(
  //     ofType(routerNavigatedAction),
  //     filter(action => action.payload.routerState.url.startsWith('/users')),
  //     take(ONE),
  //     map(() => UsersActions.load()),
  //   ),
  // );

  constructor(private actions$: Actions, private usersService: UserService, private store: Store) {}
}
