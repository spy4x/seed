import { NgModule } from '@angular/core';

import { AppComponent } from './app.component';
import { CoreModule, FRONT_WEB_CLIENT_CONFIG_INJECTION_TOKEN } from '@seed/front/web-client/core';
import { config } from '../environments/environment';

@NgModule({
  declarations: [AppComponent],
  imports: [CoreModule],
  providers: [
    {
      provide: FRONT_WEB_CLIENT_CONFIG_INJECTION_TOKEN,
      useValue: config,
    },
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}
