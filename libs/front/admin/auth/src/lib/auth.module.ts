import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Route, RouterModule } from '@angular/router';
import { SharedAuthContainerModule, SignInContainerComponent } from '@seed/front/shared/auth/container';
import {
  AUTH_IS_AUTHORIZED_HANDLER_TOKEN,
  AUTH_ROUTE_URL_FOR_AUTHENTICATION_PAGE_TOKEN,
  AUTH_ROUTE_URL_FOR_AUTHORIZED_PAGE_TOKEN,
  AUTH_ROUTE_URL_FOR_CREATING_PROFILE_TOKEN,
} from '@seed/front/shared/auth/state';
import { CreateProfileComponent } from './create-profile/create-profile.component';
import { isAuthorized } from './isAuthorized/isAuthorized.handler';
import { SharedAuthUIModule } from '@seed/front/shared/auth/ui';
import { SharedUIModule } from '@seed/front/shared/ui';

export const routes: Route[] = [
  {
    path: '',
    component: SignInContainerComponent,
  },
  {
    path: 'create-profile',
    component: CreateProfileComponent,
  },
  {
    path: '**',
    redirectTo: '',
  },
];

export const authProviders = [
  {
    provide: AUTH_ROUTE_URL_FOR_AUTHENTICATION_PAGE_TOKEN,
    useValue: '/auth',
  },
  {
    provide: AUTH_ROUTE_URL_FOR_CREATING_PROFILE_TOKEN,
    useValue: '/auth/create-profile',
  },
  {
    provide: AUTH_ROUTE_URL_FOR_AUTHORIZED_PAGE_TOKEN,
    useValue: '/',
  },
  {
    provide: AUTH_IS_AUTHORIZED_HANDLER_TOKEN,
    useValue: isAuthorized,
  },
];

@NgModule({
  imports: [CommonModule, RouterModule.forChild(routes), SharedAuthContainerModule, SharedAuthUIModule, SharedUIModule],
  declarations: [CreateProfileComponent],
})
export class AuthModule {}
