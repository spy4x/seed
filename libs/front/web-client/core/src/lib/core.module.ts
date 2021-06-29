import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';
import { AngularFireModule, FIREBASE_OPTIONS } from '@angular/fire';
import { AngularFireAuthModule } from '@angular/fire/auth';
import { FRONT_WEB_CLIENT_CONFIG_INJECTION_TOKEN, FrontWebClientConfig } from './config.interface';
import { FrontFirebaseConfig } from '@seed/front/shared/types';
import { AngularFireMessagingModule } from '@angular/fire/messaging';
import { AuthModule } from '@seed/front/shared/auth';
import { SharedContainerAuthModule, SignInContainer } from '@seed/front/shared/containers/auth';
import { StoreModule } from '@ngrx/store';
import { EffectsModule } from '@ngrx/effects';
import { StoreDevtoolsModule } from '@ngrx/store-devtools';
import { StoreRouterConnectingModule } from '@ngrx/router-store';

@NgModule({
  imports: [
    BrowserModule,
    AuthModule,
    AngularFireModule,
    AngularFireAuthModule,
    AngularFireMessagingModule,
    SharedContainerAuthModule,
    RouterModule.forRoot(
      [
        {
          path: '',
          component: SignInContainer,
        },
      ],
      { initialNavigation: 'enabledNonBlocking' },
    ),
    StoreModule.forRoot(
      {},
      {
        runtimeChecks: {
          // strictStateImmutability: true,
          // strictActionImmutability: true,
          // strictStateSerializability: true,
          // strictActionSerializability: true,
          // strictActionWithinNgZone: true,
          // strictActionTypeUniqueness: true,
        },
      },
    ),
    EffectsModule.forRoot([]),
    StoreDevtoolsModule.instrument(), // TODO: remove for production
    StoreRouterConnectingModule.forRoot(),
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
