import { createAction, props } from '@ngrx/store';
import { User } from '@prisma/client';
import { AuthProvider } from '@seed/front/shared/types';
import { AuthenticationActionPayload } from './authenticationActionPayload.interface';

const prefix = `[Auth/API]`;

/**
 * Generates action name as using prefix
 * @param actionDescription
 */
function n(actionDescription: string): string {
  return `${prefix} ${actionDescription}`;
}

export const init = createAction(n(`Init`));

export const saveOriginalURL = createAction(n(`Save original URL`), props<{ url: string }>());

export const initSignedIn = createAction(n(`Init - Signed in`), props<AuthenticationActionPayload>());

export const initNotAuthenticated = createAction(n(`Init - Not authenticated`));

export const initNotAuthenticatedButRehydrateState = createAction(
  n(`Init - Not authenticated - Rehydrate state`),
  props<{
    email: string;
    displayName?: string;
    photoURL?: string;
  }>(),
);

export const enterEmail = createAction(n(`Enter email`), props<{ email: string }>());

export const fetchProviders = createAction(n(`Fetch providers`));

export const fetchProvidersSuccess = createAction(
  n(`Fetching providers - Success`),
  props<{ providers: AuthProvider[] }>(),
);

export const signedUp = createAction(n(`Signed up`), props<AuthenticationActionPayload>());

export const signedIn = createAction(n(`Signed in`), props<AuthenticationActionPayload>());

export const signedOut = createAction(n(`Signed out`));

export const signEmailLinkRequestSent = createAction(n(`Authenticate with Email Link - Request sent`));

export const signEmailLinkFinish = createAction(n(`Authenticate with Email Link - Finish`));

export const restorePasswordSuccess = createAction(n(`Restore password - Success`));

export const actionFailed = createAction(n(`Action failed`), props<{ message: string; code?: string }>());

export const profileLoadSuccess = createAction(n(`Profile - Load - Success`), props<{ user: User }>());

export const profileLoadSuccessNoProfileYet = createAction(n(`Profile - Load - Success - No profile exists yet`));

export const profileCreateSuccess = createAction(n(`Profile - Create - Success`), props<{ user: User }>());

export const authorize = createAction(n(`Authorize`));

export const authorized = createAction(n(`Authorized`));

export const notAuthorized = createAction(n(`Not authorized`), props<{ reason: string }>());

export const setJWT = createAction(n(`Set JWT`), props<{ jwt?: string }>());
