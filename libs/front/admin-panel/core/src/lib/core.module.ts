import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';
import { AngularFireModule, FIREBASE_OPTIONS } from '@angular/fire';
import { AngularFireAuthModule } from '@angular/fire/auth';
import { AngularFireMessagingModule } from '@angular/fire/messaging';
import { FrontFirebaseConfig } from '@seed/front/shared/types';
import { FRONT_ADMIN_PANEL_CONFIG_INJECTION_TOKEN, FrontAdminPanelConfig } from './config.interface';
import { SharedAuthContainerModule, SignInContainerComponent } from '@seed/front/shared/auth/container';
import { StoreModule } from '@ngrx/store';
import { EffectsModule } from '@ngrx/effects';
import { StoreDevtoolsModule } from '@ngrx/store-devtools';
import { StoreRouterConnectingModule } from '@ngrx/router-store';

@NgModule({
  imports: [
    BrowserModule,
    AngularFireModule,
    AngularFireAuthModule,
    AngularFireMessagingModule,
    SharedAuthContainerModule,
    RouterModule.forRoot(
      [
        {
          path: '',
          component: SignInContainerComponent,
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
      useFactory: (config: FrontAdminPanelConfig): FrontFirebaseConfig => config.firebase,
      deps: [FRONT_ADMIN_PANEL_CONFIG_INJECTION_TOKEN],
    },
  ],
  exports: [RouterModule],
})
export class CoreModule {}
