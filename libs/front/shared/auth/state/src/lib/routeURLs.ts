import { InjectionToken } from '@angular/core';

export const AUTH_ROUTE_URL_FOR_CREATING_PROFILE_TOKEN = new InjectionToken<string>(
  'AUTH_ROUTE_URL_FOR_CREATING_PROFILE',
);
export const AUTH_ROUTE_URL_FOR_CREATING_PROFILE_DEFAULT = '/create-profile';

export const AUTH_ROUTE_URL_FOR_AUTHORIZED_PAGE_TOKEN = new InjectionToken<string>(
  'AUTH_ROUTE_URL_FOR_AUTHORIZED_PAGE',
);
export const AUTH_ROUTE_URL_FOR_AUTHORIZED_PAGE_DEFAULT = '/home';

export const AUTH_ROUTE_URL_FOR_NOT_AUTHORIZED_PAGE_TOKEN = new InjectionToken<string>(
  'AUTH_ROUTE_URL_FOR_NOT_AUTHORIZED_PAGE',
);
export const AUTH_ROUTE_URL_FOR_NOT_AUTHORIZED_PAGE_DEFAULT = '/not-authorized';
