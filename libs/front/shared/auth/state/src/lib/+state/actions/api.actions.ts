import { createAction, props } from '@ngrx/store';
import { AuthProvider } from '@seed/front/shared/types';
import { AuthenticationActionPayload } from './authenticationActionPayload.interface';

const prefix = `[Auth/API]`;
export const init = createAction(`${prefix} Init`);

export const initSignedIn = createAction(`${prefix} Init - Signed in`, props<AuthenticationActionPayload>());

export const initNotAuthenticated = createAction(`${prefix} Init - Not authenticated`);

export const initNotAuthenticatedButRehydrateState = createAction(
  `${prefix} Init - Not authenticated - Rehydrate state`,
  props<{
    email: string;
    displayName?: string;
    photoURL?: string;
  }>(),
);

export const enterEmail = createAction(`${prefix} Enter email`, props<{ email: string }>());

export const fetchProviders = createAction(`${prefix} Fetch providers`);

export const fetchProvidersSuccess = createAction(
  `${prefix} Fetching providers - Success`,
  props<{ providers: AuthProvider[] }>(),
);

export const signedUp = createAction(`${prefix} Signed up`, props<AuthenticationActionPayload>());

export const signedIn = createAction(`${prefix} Signed in`, props<AuthenticationActionPayload>());

export const signedOut = createAction(`${prefix} Signed out`);

export const signEmailLinkRequestSent = createAction(`${prefix} Authenticate with Email Link - Request sent`);

export const signEmailLinkFinish = createAction(`${prefix} Authenticate with Email Link - Finish`);

export const restorePasswordSuccess = createAction(`${prefix} Restore password - Success`);

export const actionFailed = createAction(`${prefix} Action failed`, props<{ message: string; code?: string }>());
