import { createAction, props } from '@ngrx/store';
import { AuthProvider } from '@seed/front/shared/types';

const prefix = `[Auth/API]`;
export const init = createAction(`${prefix} Init`);

export const initAuthenticated = createAction(`${prefix} Init - Authenticated`, props<{ userId: string }>());

export const initNotAuthenticated = createAction(`${prefix} Init - Not authenticated`);

export const fetchProviders = createAction(`${prefix} Fetch providers`);

export const fetchProvidersSuccess = createAction(
  `${prefix} Fetching providers - Success`,
  props<{ providers: AuthProvider[] }>(),
);

export const signedUp = createAction(`${prefix} Signed up`, props<{ userId: string }>());

export const authenticateWithEmailLinkRequestSent = createAction(
  `${prefix} Authenticate with Email Link - Request sent`,
);

export const authenticateWithEmailLinkFinish = createAction(`${prefix} Authenticate with Email Link - Finish`);

export const restorePasswordSuccess = createAction(`${prefix} Restore password - Success`);

export const authenticated = createAction(`${prefix} Authenticated`, props<{ userId: string }>());

export const actionFailed = createAction(`${prefix} Action failed`, props<{ message: string; code?: string }>());

export const signedOut = createAction(`${prefix} Signed out`);
