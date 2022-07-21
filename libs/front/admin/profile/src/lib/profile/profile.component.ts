import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'admin-profile',
  templateUrl: './profile.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileComponent {}
