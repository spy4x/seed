import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';
import { AngularFireModule, FIREBASE_OPTIONS } from '@angular/fire';
import { AngularFireAuthModule } from '@angular/fire/auth';
import { FRONT_WEB_CLIENT_CONFIG_INJECTION_TOKEN, FrontWebClientConfig } from './config.interface';
import { FrontFirebaseConfig } from '@seed/front/shared/types';
import { AngularFireMessagingModule } from '@angular/fire/messaging';
import { AuthModule } from '@seed/front/shared/auth';
import { SignInComponent } from '@seed/front/shared/ui/auth';

@NgModule({
  imports: [
    BrowserModule,
    AuthModule,
    AngularFireModule,
    AngularFireAuthModule,
    AngularFireMessagingModule,
    RouterModule.forRoot(
      [
        {
          path: '',
          component: SignInComponent,
        },
      ],
      { initialNavigation: 'enabledNonBlocking' },
    ),
  ],
  providers: [
    {
      provide: FIREBASE_OPTIONS,
      useFactory: (config: FrontWebClientConfig): FrontFirebaseConfig => config.firebase,
      deps: [FRONT_WEB_CLIENT_CONFIG_INJECTION_TOKEN],
    },
  ],
  exports: [RouterModule],
})
export class CoreModule {}
