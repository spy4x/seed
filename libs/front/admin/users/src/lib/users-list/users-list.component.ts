import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'seed-admin-users-list',
  templateUrl: './users-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UsersListComponent {}
