import { enableProdMode } from '@angular/core';
import { config } from './environments/environment';
import { Environment } from '@seed/shared/types';
import { AppComponent, providers } from './app/app.component';
import { bootstrapApplication } from '@angular/platform-browser';

if (config.environment === Environment.production) {
  enableProdMode();
}

bootstrapApplication(AppComponent, { providers })
  // eslint-disable-next-line no-console
  .catch(err => console.error(err));
