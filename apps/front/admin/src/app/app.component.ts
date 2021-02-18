import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'seed-admin-root',
  template: '<router-outlet></router-outlet>',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {}
