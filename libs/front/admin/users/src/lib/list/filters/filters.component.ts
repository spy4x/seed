import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnInit,
  Output,
  SimpleChanges,
} from '@angular/core';
import { UserRole } from '@prisma/client';
import { FormControl } from '@angular/forms';
import { UntilDestroy, untilDestroyed } from '@ngneat/until-destroy';
import { ZERO } from '@seed/shared/constants';

@UntilDestroy()
@Component({
  selector: 'seed-admin-users-filters',
  templateUrl: './filters.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FiltersComponent implements OnInit, OnChanges {
  UserRole = UserRole;

  roleTitles = [
    { value: undefined, title: 'All' },
    { value: UserRole.USER, title: 'Users' },
    { value: UserRole.ADMIN, title: 'Admins' },
    { value: UserRole.MODERATOR, title: 'Moderators' },
  ];

  @Input() isLoading = true;

  @Input() role?: UserRole;

  @Input() total = ZERO;

  @Output() roleChange = new EventEmitter<UserRole>();

  tabControl = new FormControl<undefined | UserRole>(this.role);

  ngOnInit(): void {
    this.tabControl.valueChanges.pipe(untilDestroyed(this)).subscribe(role => {
      this.changeRole(role as UserRole);
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['role'] && changes['role'].currentValue !== changes['role'].previousValue) {
      this.tabControl.setValue(this.role);
    }
  }

  changeRole(role?: UserRole): void {
    if (role !== this.role) {
      this.roleChange.emit(role);
    }
  }
}
