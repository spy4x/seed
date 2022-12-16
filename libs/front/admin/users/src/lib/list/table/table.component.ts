import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { User } from '@prisma/client';
import { dateFormat, dateTimeFormat } from '@seed/shared/constants';

@Component({
  selector: 'seed-admin-users-table',
  templateUrl: './table.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TableComponent {
  @Input() users: User[] = [];

  @Input() isLoading = true;

  dateFormat = dateFormat;

  dateTimeFormat = dateTimeFormat;

  trackByFn(_index: number, item: User): string {
    return item.id;
  }
}
