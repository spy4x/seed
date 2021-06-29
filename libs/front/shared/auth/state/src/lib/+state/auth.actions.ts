import { createAction, props } from '@ngrx/store';

export const authenticateAnonymously = createAction('[Auth/UI] Authenticate anonymously');

export const authenticated = createAction('[Auth/API] Authenticated', props<{ userId: string }>());

export const notAuthenticated = createAction('[Auth/API] Not authenticated');

export const signOut = createAction('[Auth/UI] Sign out');
