import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'afsc-root',
  template: '<router-outlet></router-outlet>',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  title = 'Client';
}
