import { Injectable } from '@angular/core';
import { Actions, concatLatestFrom, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { UsersActions, UsersSelectors } from './list.state';
import { UserService } from '@seed/front/shared/auth/state';
import { Store } from '@ngrx/store';

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

  constructor(
    private readonly actions$: Actions,
    private readonly usersService: UserService,
    private readonly store: Store,
  ) {}
}
