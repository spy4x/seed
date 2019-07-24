import { BrowserModule } from '@angular/platform-browser';
import { NgModule } from '@angular/core';

import { AppComponent } from './app.component';
import { RouterModule } from '@angular/router';
import { SharedComponentsModule } from '@afs/shared-components';

/**
 * Root module of the app. Imports non-lazy modules and dependencies
 */
@NgModule({
  bootstrap: [AppComponent],
  declarations: [AppComponent],
  imports: [BrowserModule, RouterModule.forRoot([], { initialNavigation: 'enabled' }), SharedComponentsModule],
  providers: []
})
export class AppModule {}
