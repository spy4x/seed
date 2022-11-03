import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';
import { AngularFireModule, FIREBASE_OPTIONS } from '@angular/fire/compat';
import { AngularFireAuthModule, USE_EMULATOR as USE_AUTH_EMULATOR } from '@angular/fire/compat/auth';
import { AngularFireMessagingModule } from '@angular/fire/compat/messaging';
import { FrontFirebaseConfig } from '@seed/front/shared/types';
import { FRONT_WEB_CLIENT_CONFIG_INJECTION_TOKEN, FrontWebClientConfig } from './config.interface';
import { StoreModule } from '@ngrx/store';
import { EffectsModule } from '@ngrx/effects';
import { StoreDevtoolsModule } from '@ngrx/store-devtools';
import { IsAuthorizedGuard, IsNotAuthorizedGuard } from '@seed/front/shared/auth/guards';
import { SharedAuthStateModule } from '@seed/front/shared/auth/state';
import { SharedRouterModule } from '@seed/front/shared/router';

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
          // eslint-disable-next-line @typescript-eslint/explicit-function-return-type,@typescript-eslint/promise-function-async
          loadChildren: () => import('@seed/front/web/auth').then(m => m.AuthModule),
          canActivate: [IsNotAuthorizedGuard],
        },
        {
          path: 'profile',
          // eslint-disable-next-line @typescript-eslint/explicit-function-return-type,@typescript-eslint/promise-function-async
          loadChildren: () => import('@seed/front/web/profile').then(m => m.ProfileModule),
          canActivate: [IsAuthorizedGuard],
        },
        {
          path: '**',
          redirectTo: 'profile',
        },
      ],
      { initialNavigation: 'enabledBlocking' },
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
    SharedRouterModule,
  ],
  providers: [
    {
      provide: USE_AUTH_EMULATOR,
      useFactory: (config: FrontWebClientConfig): undefined | string[] =>
        config.firebase.useEmulator ? ['http://localhost:9099'] : undefined,
      deps: [FRONT_WEB_CLIENT_CONFIG_INJECTION_TOKEN],
    },
    {
      provide: FIREBASE_OPTIONS,
      useFactory: (config: FrontWebClientConfig): FrontFirebaseConfig => config.firebase,
      deps: [FRONT_WEB_CLIENT_CONFIG_INJECTION_TOKEN],
    },
  ],
  exports: [RouterModule],
})
export class CoreModule {}
