import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';
import { AngularFireModule, FIREBASE_OPTIONS } from '@angular/fire/compat';
import { AngularFireAuthModule } from '@angular/fire/compat/auth';
import { AngularFireMessagingModule } from '@angular/fire/compat/messaging';
import { FrontFirebaseConfig } from '@seed/front/shared/types';
import { FRONT_ADMIN_PANEL_CONFIG_INJECTION_TOKEN, FrontAdminPanelConfig } from './config.interface';
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
          loadChildren: () => import('@seed/front/admin/auth').then(m => m.AuthModule),
          canActivate: [IsNotAuthorizedGuard],
        },
        {
          path: 'profile',
          // eslint-disable-next-line @typescript-eslint/explicit-function-return-type,@typescript-eslint/promise-function-async
          loadChildren: () => import('@seed/front/admin/profile').then(m => m.ProfileModule),
          canActivate: [IsAuthorizedGuard],
        },
        {
          path: 'users',
          // eslint-disable-next-line @typescript-eslint/explicit-function-return-type,@typescript-eslint/promise-function-async
          loadChildren: () => import('@seed/front/admin/users').then(m => m.UsersModule),
          canActivate: [IsAuthorizedGuard],
        },
        {
          path: '**',
          redirectTo: 'users',
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
      provide: FIREBASE_OPTIONS,
      useFactory: (config: FrontAdminPanelConfig): FrontFirebaseConfig => config.firebase,
      deps: [FRONT_ADMIN_PANEL_CONFIG_INJECTION_TOKEN],
    },
  ],
  exports: [RouterModule],
})
export class CoreModule {}
