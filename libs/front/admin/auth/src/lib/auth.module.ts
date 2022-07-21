import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Route, RouterModule } from '@angular/router';
import { SharedAuthContainerModule, SignInContainerComponent } from '@seed/front/shared/auth/container';
import {
  AUTH_IS_AUTHORIZED_HANDLER_TOKEN,
  AUTH_ROUTE_URL_FOR_AUTHENTICATION_PAGE_TOKEN,
  AUTH_ROUTE_URL_FOR_AUTHORIZED_PAGE_TOKEN,
  AUTH_ROUTE_URL_FOR_CREATING_PROFILE_TOKEN,
  IsAuthorizedHandler,
} from '@seed/front/shared/auth/state';
import { User, UserRole } from '@prisma/client';
import { CreateProfileComponent } from './create-profile/create-profile.component';

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

const isAuthorized: IsAuthorizedHandler = async (user: User) =>
  Promise.resolve(
    ([UserRole.ADMIN, UserRole.MODERATOR] as UserRole[]).includes(user.role)
      ? true
      : 'User is not an Admin or Moderator.',
  );

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
    {
      provide: AUTH_IS_AUTHORIZED_HANDLER_TOKEN,
      useValue: isAuthorized,
    },
  ],
})
export class AuthModule {}
