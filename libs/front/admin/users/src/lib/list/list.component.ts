import { ChangeDetectionStrategy, Component, OnInit, ViewEncapsulation } from '@angular/core';
import { User, UserRole } from '@prisma/client';
import { BehaviorSubject } from 'rxjs';
import { mockUsers } from '@seed/shared/mock-data';
import { ONE, PAGINATION_DEFAULTS, THOUSAND, ZERO } from '@seed/shared/constants';

@Component({
  selector: 'seed-admin-users-list',
  templateUrl: './list.component.html',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListComponent implements OnInit {
  users$ = new BehaviorSubject<User[]>([]);

  isLoading$ = new BehaviorSubject<boolean>(true);

  page$ = new BehaviorSubject<number>(ONE);

  total$ = new BehaviorSubject<number>(ZERO);

  limit$ = new BehaviorSubject<number>(PAGINATION_DEFAULTS.limit);

  role$ = new BehaviorSubject<UserRole>(UserRole.USER);

  ngOnInit(): void {
    setTimeout(() => {
      const allUsersOfThisRole = mockUsers.filter(user => user.role === this.role$.value);
      const users = allUsersOfThisRole.slice(
        (this.page$.value - ONE) * this.limit$.value,
        this.page$.value * this.limit$.value,
      );
      this.users$.next(users);
      this.isLoading$.next(false);
      this.page$.next(ONE);
      this.total$.next(allUsersOfThisRole.length);
    }, THOUSAND);
  }

  onPageChange(page: number): void {
    this.isLoading$.next(true);
    setTimeout(() => {
      const allUsersOfThisRole = mockUsers.filter(user => user.role === this.role$.value);
      const users = allUsersOfThisRole.slice((page - ONE) * this.limit$.value, page * this.limit$.value);
      this.page$.next(page);
      this.users$.next(users);
      this.isLoading$.next(false);
    }, THOUSAND);
  }

  onRoleChange(role: UserRole): void {
    this.isLoading$.next(true);
    this.role$.next(role);
    setTimeout(() => {
      this.page$.next(ONE);
      const allUsersOfThisRole = mockUsers.filter(user => user.role === this.role$.value);
      const users = allUsersOfThisRole.slice(
        (this.page$.value - ONE) * this.limit$.value,
        this.page$.value * this.limit$.value,
      );
      this.users$.next(users);
      this.total$.next(allUsersOfThisRole.length);
      this.isLoading$.next(false);
    }, THOUSAND);
  }
}
