import { createAction, props } from '@ngrx/store';

export const init = createAction('[Auth/API] Init');

export const authenticatedAfterInit = createAction('[Auth/API] Authenticated after Init', props<{ userId: string }>());

export const notAuthenticated = createAction('[Auth/API] Not authenticated');

export const authenticatedAfterUserAction = createAction(
  '[Auth/API] Authenticated after User action',
  props<{ userId: string }>(),
);

export const signedUp = createAction('[Auth/API] Signed up', props<{ userId: string }>());

export const authenticateAnonymously = createAction('[Auth/UI] Authenticate anonymously');

export const authenticateWithGoogle = createAction('[Auth/UI] Authenticate with Google');

export const authenticateWithGitHub = createAction('[Auth/UI] Authenticate with GitHub');

export const authenticateWithEmailAndPassword = createAction(
  '[Auth/UI] Authenticate with Email and Password',
  props<{ email: string; password: string }>(),
);
export const signUpWithEmailAndPassword = createAction(
  '[Auth/UI] Sign up with Email and Password',
  props<{ email: string; password: string }>(),
);

export const authenticationFailed = createAction('[Auth/API] Authentication failed', props<{ errorMessage: string }>());

export const signOut = createAction('[Auth/UI] Sign out');

export const signedOut = createAction('[Auth/API] Signed out');
