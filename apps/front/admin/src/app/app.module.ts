import { NgModule } from '@angular/core';

import { AppComponent } from './app.component';
import { CoreModule, FRONT_ADMIN_CONFIG_TOKEN } from '@seed/front/admin/core';
import { config } from '../environments/environment';

@NgModule({
  declarations: [AppComponent],
  imports: [CoreModule],
  providers: [
    {
      provide: FRONT_ADMIN_CONFIG_TOKEN,
      useValue: config,
    },
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}
