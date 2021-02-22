import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'seed-admin-panel-root',
  template: '<router-outlet></router-outlet>',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {}
