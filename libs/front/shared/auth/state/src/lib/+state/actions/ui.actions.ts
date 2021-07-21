import { createAction, props } from '@ngrx/store';
import { AuthProvider } from '@seed/front/shared/types';

const prefix = `[Auth/UI]`;

export const enterEmail = createAction(`${prefix} Enter email`, props<{ email: string }>());

export const changeUser = createAction(`${prefix} Change user`);

export const selectProvider = createAction(`${prefix} Select provider`, props<{ provider: AuthProvider }>());

export const deselectProvider = createAction(`${prefix} Deselect provider`);

export const signAnonymously = createAction(`${prefix} Sign up anonymously`);

export const signGoogle = createAction(`${prefix} Authenticate with Google`);

export const signGitHub = createAction(`${prefix} Authenticate with GitHub`);

export const signEmailLink = createAction(`${prefix} Authenticate with Email Link`);

export const signEmailPassword = createAction(`${prefix} Sign with Email and Password`, props<{ password: string }>());

export const restorePassword = createAction(`${prefix} Restore password`);

export const signOut = createAction(`${prefix} Sign out`);
