import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'admin-users',
  templateUrl: './users.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UsersComponent {}
