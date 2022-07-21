import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Route, RouterModule } from '@angular/router';
import { CreateProfileComponent } from './create-profile/create-profile.component';
import { SharedAuthContainerModule, SignInContainerComponent } from '@seed/front/shared/auth/container';
import {
  AUTH_ROUTE_URL_FOR_AUTHENTICATION_PAGE_TOKEN,
  AUTH_ROUTE_URL_FOR_AUTHORIZED_PAGE_TOKEN,
  AUTH_ROUTE_URL_FOR_CREATING_PROFILE_TOKEN,
} from '@seed/front/shared/auth/state';

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

@NgModule({
  imports: [CommonModule, RouterModule.forChild(routes), SharedAuthContainerModule],
  declarations: [CreateProfileComponent],
  providers: [
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
  ],
})
export class AuthModule {}
