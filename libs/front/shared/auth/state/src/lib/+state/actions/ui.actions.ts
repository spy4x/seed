import { createAction, props } from '@ngrx/store';
import { Prisma } from '@prisma/client';
import { AuthProvider } from '@seed/front/shared/types';

const prefix = `[Auth/UI]`;

/**
 * Generates action name as using prefix
 * @param actionDescription
 */
function n(actionDescription: string): string {
  return `${prefix} ${actionDescription}`;
}

export const enterEmail = createAction(n(`Enter email`), props<{ email: string }>());

export const changeUser = createAction(n(`Change user`));

export const selectProvider = createAction(n(`Select provider`), props<{ provider: AuthProvider }>());

export const deselectProvider = createAction(n(`Deselect provider`));

export const signAnonymously = createAction(n(`Sign up anonymously`));

export const signGoogle = createAction(n(`Authenticate with Google`));

export const signGitHub = createAction(n(`Authenticate with GitHub`));

export const signEmailLink = createAction(n(`Authenticate with Email Link`));

export const signEmailPassword = createAction(n(`Sign with Email and Password`), props<{ password: string }>());

export const restorePassword = createAction(n(`Restore password`));

export const signOut = createAction(n(`Sign out`));

export const profileCreate = createAction(n(`Profile - Create`), props<{ user: Prisma.UserCreateInput }>());
