import { ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { User } from '@prisma/client';
import { dateFormat, dateTimeFormat } from '@seed/shared/constants';

@Component({
  selector: 'seed-admin-users-table',
  templateUrl: './table.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TableComponent implements OnChanges {
  @Input() users: User[] = [];

  @Input() isLoading = true;

  dateFormat = dateFormat;

  dateTimeFormat = dateTimeFormat;

  trackByFn(_index: number, item: User): string {
    return item.id;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['users']) {
      console.log('users', this.users);
    }
  }
}
