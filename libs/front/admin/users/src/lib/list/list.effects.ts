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
      ofType(UsersActions.loadUsers),
      concatLatestFrom(() => [
        this.store.select(UsersSelectors.selectUsersFilter),
        this.store.select(UsersSelectors.selectUsersPagedRequest),
      ]),
      switchMap(([, filter, pagination]) =>
        this.usersService.find(pagination.page + 1, pagination.size, filter).pipe(
          map(res => UsersActions.loadUsersSuccess({ entities: res.data, total: res.total })),
          catchError(() => of(UsersActions.loadUsersFail())),
        ),
      ),
    ),
  );

  constructor(private actions$: Actions, private usersService: UserService, private store: Store) {}
}
