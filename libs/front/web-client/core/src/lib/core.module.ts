import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';
import { AngularFireModule, FIREBASE_OPTIONS } from '@angular/fire';
import { AngularFireAuthModule } from '@angular/fire/auth';
import { AngularFireMessagingModule } from '@angular/fire/messaging';
import { FrontFirebaseConfig } from '@seed/front/shared/types';
import { FRONT_WEB_CLIENT_CONFIG_INJECTION_TOKEN, FrontWebClientConfig } from './config.interface';
import { StoreModule } from '@ngrx/store';
import { EffectsModule } from '@ngrx/effects';
import { StoreDevtoolsModule } from '@ngrx/store-devtools';
import { StoreRouterConnectingModule } from '@ngrx/router-store';
import { IsAuthorizedGuard, IsNotAuthorizedGuard } from '@seed/front/shared/auth/guards';
import { SharedAuthStateModule } from '@seed/front/shared/auth/state';

@NgModule({
  imports: [
    BrowserModule,
    AngularFireModule,
    AngularFireAuthModule,
    AngularFireMessagingModule,
    SharedAuthStateModule,
    RouterModule.forRoot(
      [
        {
          path: 'auth',
          // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
          loadChildren: async () => import('@seed/front/web-client/auth').then(m => m.AuthModule),
          canActivate: [IsNotAuthorizedGuard],
        },
        {
          path: 'profile',
          // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
          loadChildren: async () => import('@seed/front/web-client/profile').then(m => m.ProfileModule),
          canActivate: [IsAuthorizedGuard],
        },
        {
          path: '**',
          redirectTo: 'profile',
        },
      ],
      { initialNavigation: 'enabledNonBlocking' },
    ),
    StoreModule.forRoot(
      {},
      {
        runtimeChecks: {
          strictStateImmutability: true,
          strictActionImmutability: true,
          strictStateSerializability: true,
          strictActionSerializability: true,
          strictActionWithinNgZone: true,
          strictActionTypeUniqueness: true,
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
