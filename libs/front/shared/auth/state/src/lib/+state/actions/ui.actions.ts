import { createAction, props } from '@ngrx/store';
import { AuthProvider } from '@seed/front/shared/types';

const prefix = `[Auth/UI]`;

export const signUpAnonymously = createAction(`${prefix} Sign up anonymously`);

export const enterEmail = createAction(`${prefix} Enter email`, props<{ email: string }>());

export const changeUser = createAction(`${prefix} Change user`);

export const chooseProvider = createAction(
  `${prefix} Choose provider`,
  props<{ provider: undefined | AuthProvider }>(),
);

export const authenticateWithGoogle = createAction(`${prefix} Authenticate with Google`);

export const authenticateWithGitHub = createAction(`${prefix} Authenticate with GitHub`);

export const authenticateWithEmailLink = createAction(`${prefix} Authenticate with Email Link`);

export const signInWithEmailAndPassword = createAction(
  `${prefix} Sign in with Email and Password`,
  props<{ password: string }>(),
);

export const signUpWithEmailAndPassword = createAction(
  `${prefix} Sign up with Email and Password`,
  props<{ password: string }>(),
);

export const restorePassword = createAction(`${prefix} Restore password`);

export const signOut = createAction(`${prefix} Sign out`);
