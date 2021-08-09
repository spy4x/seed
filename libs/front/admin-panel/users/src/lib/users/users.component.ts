import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'seed-admin-panel-users',
  templateUrl: './users.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UsersComponent {}
