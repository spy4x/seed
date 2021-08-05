import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'seed-web-client-profile',
  templateUrl: './profile.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileComponent {}
