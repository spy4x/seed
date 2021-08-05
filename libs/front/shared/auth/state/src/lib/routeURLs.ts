import { InjectionToken } from '@angular/core';

export const AUTH_ROUTE_URL_FOR_AUTHENTICATION_PAGE_TOKEN = new InjectionToken<string>(
  'AUTH_ROUTE_URL_FOR_AUTHENTICATION_PAGE',
);

export const AUTH_ROUTE_URL_FOR_AUTHENTICATION_PAGE_DEFAULT = '/auth';

export const AUTH_ROUTE_URL_FOR_CREATING_PROFILE_TOKEN = new InjectionToken<string>(
  'AUTH_ROUTE_URL_FOR_CREATING_PROFILE',
);

export const AUTH_ROUTE_URL_FOR_CREATING_PROFILE_DEFAULT = '/auth/create-profile';

export const AUTH_ROUTE_URL_FOR_AUTHORIZED_PAGE_TOKEN = new InjectionToken<string>(
  'AUTH_ROUTE_URL_FOR_AUTHORIZED_PAGE',
);

export const AUTH_ROUTE_URL_FOR_AUTHORIZED_PAGE_DEFAULT = '/';
