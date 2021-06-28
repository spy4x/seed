import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';
import { AuthModule } from '@seed/front/shared/auth';
import { SignInComponent } from '../../../../shared/auth/src/lib/sign-in/sign-in.component';
import { AngularFireModule, FIREBASE_OPTIONS } from '@angular/fire';
import { AngularFireAuthModule } from '@angular/fire/auth';
import { AngularFireMessagingModule } from '@angular/fire/messaging';
import { FrontFirebaseConfig } from '@seed/front/shared/types';
import { FRONT_ADMIN_PANEL_CONFIG_INJECTION_TOKEN, FrontAdminPanelConfig } from './config.interface';

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
      useFactory: (config: FrontAdminPanelConfig): FrontFirebaseConfig => config.firebase,
      deps: [FRONT_ADMIN_PANEL_CONFIG_INJECTION_TOKEN],
    },
  ],
  exports: [RouterModule],
})
export class CoreModule {}
