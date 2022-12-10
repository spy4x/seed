import { ChangeDetectionStrategy, Component, OnInit, ViewEncapsulation } from '@angular/core';
import { UserRole } from '@prisma/client';
import { first } from 'rxjs';
import { Store } from '@ngrx/store';
import { UsersActions, UsersSelectors } from './list.state';
import { PAGINATION_DEFAULTS } from '@seed/shared/constants';
import { map } from 'rxjs/operators';

@Component({
  selector: 'seed-admin-users-list',
  templateUrl: './list.component.html',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListComponent implements OnInit {
  page$ = this.store.select(UsersSelectors.selectUsersCurrentPage);

  role$ = this.store.select(UsersSelectors.selectUsersFilter).pipe(map(filter => filter?.role));

  limit = PAGINATION_DEFAULTS.limit;

  constructor(private store: Store) {}

  ngOnInit(): void {
    this.store
      .select(UsersSelectors.isUsersLoadingSuccess)
      .pipe(first())
      .subscribe(loaded => !loaded && this.store.dispatch(UsersActions.loadUsers()));
  }

  onPageChange(page: number): void {
    this.store.dispatch(UsersActions.loadUsersPage({ index: page - 1 }));
  }

  onRoleChange(role?: UserRole): void {
    this.store.dispatch(UsersActions.filterUsers({ filters: { role }, patch: true }));
  }
}
