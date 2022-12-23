import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FRONT_WEB_CONFIG_TOKEN } from '@seed/front/web/core';
import { config } from '../environments/environment';
import { RouterLink, RouterOutlet } from '@angular/router';
import { router } from '@seed/front/admin/core';

export const providers = [
  {
    provide: FRONT_WEB_CONFIG_TOKEN,
    useValue: config,
  },
  router,
];

@Component({
  standalone: true,
  selector: 'web-root',
  template: ` <nav>
      <button routerLink="/invoices">Invoices</button>
      <button routerLink="/contracts">Contracts</button>
    </nav>
    <router-outlet></router-outlet>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink],
})
export class AppComponent {}
