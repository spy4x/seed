import { ChangeDetectionStrategy, Component } from '@angular/core';
import { UserRole } from '@prisma/client';
import { Store } from '@ngrx/store';
import { UsersActions, UsersSelectors } from './list.state';

@Component({
  selector: 'seed-admin-users-list',
  templateUrl: './list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListComponent {
  vm$ = this.store.select(UsersSelectors.state);

  users$ = this.store.select(UsersSelectors.array);

  constructor(private readonly store: Store) {}

  onPageChange(page: number): void {
    this.store.dispatch(UsersActions.setPage({ page }));
  }

  onRoleChange(role?: UserRole): void {
    this.store.dispatch(UsersActions.patchFilter({ filter: { role } }));
  }
}
