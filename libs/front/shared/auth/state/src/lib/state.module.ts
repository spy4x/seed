import { NgModule } from '@angular/core';
import { Store, StoreModule } from '@ngrx/store';
import { EffectsModule } from '@ngrx/effects';
import * as fromAuth from './+state/auth.reducer';
import { AuthenticationEffects } from './+state/effects/authentication.effects';
import { AuthorizationEffects } from './+state/effects/authorization.effects';
import { init } from './+state/actions/api.actions';
import {
  AUTH_ROUTE_URL_FOR_AUTHENTICATION_PAGE_TOKEN,
  AUTH_ROUTE_URL_FOR_AUTHENTICATION_PAGE_DEFAULT,
  AUTH_ROUTE_URL_FOR_CREATING_PROFILE_DEFAULT,
  AUTH_ROUTE_URL_FOR_CREATING_PROFILE_TOKEN,
  AUTH_ROUTE_URL_FOR_AUTHORIZED_PAGE_DEFAULT,
  AUTH_ROUTE_URL_FOR_AUTHORIZED_PAGE_TOKEN,
} from './routeURLs';
import { RouterModule } from '@angular/router';
import { AUTH_IS_AUTHORIZED_HANDLER_DEFAULT, AUTH_IS_AUTHORIZED_HANDLER_TOKEN } from './isAuthorized';
import { UserService } from './userService/user.service';
import { HttpClientModule } from '@angular/common/http';

@NgModule({
  imports: [
    StoreModule.forFeature(fromAuth.AUTH_FEATURE_KEY, fromAuth.reducer),
    EffectsModule.forFeature([AuthenticationEffects, AuthorizationEffects]),
    RouterModule,
    HttpClientModule,
  ],
  providers: [
    { provide: AUTH_ROUTE_URL_FOR_AUTHENTICATION_PAGE_TOKEN, useValue: AUTH_ROUTE_URL_FOR_AUTHENTICATION_PAGE_DEFAULT },
    { provide: AUTH_ROUTE_URL_FOR_CREATING_PROFILE_TOKEN, useValue: AUTH_ROUTE_URL_FOR_CREATING_PROFILE_DEFAULT },
    { provide: AUTH_ROUTE_URL_FOR_AUTHORIZED_PAGE_TOKEN, useValue: AUTH_ROUTE_URL_FOR_AUTHORIZED_PAGE_DEFAULT },
    { provide: AUTH_IS_AUTHORIZED_HANDLER_TOKEN, useValue: AUTH_IS_AUTHORIZED_HANDLER_DEFAULT },
    UserService,
  ],
})
export class SharedAuthStateModule {
  constructor(store: Store) {
    store.dispatch(init());
  }
}
