import { Action, createReducer, on } from '@ngrx/store';

import * as AuthActions from './auth.actions';
import { AuthMethod, AuthStage, PreviouslyAuthenticatedUser } from '@seed/front/shared/types';

export const AUTH_FEATURE_KEY = 'auth';

export interface State {
  stage: AuthStage;
  prevUser?: PreviouslyAuthenticatedUser;
  email?: string;
  userId?: string;
  inProgress: boolean;
  providers: AuthMethod[];
  selectedProvider?: AuthMethod;
  error?: {
    message: string;
    code?: string;
  };
  successMessage?: string;
}

export interface AuthPartialState {
  readonly [AUTH_FEATURE_KEY]: State;
}

export const initialState: State = {
  stage: AuthStage.init,
  inProgress: false,
  providers: [],
};

const authReducer = createReducer<State>(
  initialState,
  on(
    AuthActions.init,
    (state: State): State => ({
      ...state,
      inProgress: true,
      stage: AuthStage.init,
      error: undefined,
      successMessage: undefined,
    }),
  ),
  on(
    AuthActions.authenticatedAfterInit,
    AuthActions.authenticatedAfterUserAction,
    AuthActions.signedUp,
    (state: State, { userId }): State => ({
      ...state,
      userId,
      inProgress: false,

      error: undefined,
      successMessage: undefined,
    }),
  ),
  on(
    AuthActions.notAuthenticated,
    (state: State): State => ({
      ...state,
      userId: undefined,
      inProgress: false,

      error: undefined,
      successMessage: undefined,
    }),
  ),
  on(
    AuthActions.authenticateAnonymously,
    (state: State): State => ({
      ...state,
      inProgress: true,
      methodInProgress: AuthMethod.anonymous,
      error: undefined,
      successMessage: undefined,
    }),
  ),
  on(
    AuthActions.authenticateWithGoogle,
    (state: State): State => ({
      ...state,
      inProgress: true,
      methodInProgress: AuthMethod.google,
      error: undefined,
      successMessage: undefined,
    }),
  ),
  on(
    AuthActions.authenticateWithGitHub,
    (state: State): State => ({
      ...state,
      inProgress: true,
      methodInProgress: AuthMethod.github,
      error: undefined,
      successMessage: undefined,
    }),
  ),
  on(
    AuthActions.authenticateWithEmailAndPassword,
    AuthActions.signUpWithEmailAndPassword,
    (state: State): State => ({
      ...state,
      inProgress: true,
      methodInProgress: AuthMethod.password,
      error: undefined,
      successMessage: undefined,
    }),
  ),
  on(
    AuthActions.authenticateWithEmailLink,
    (state: State): State => ({
      ...state,
      inProgress: true,
      methodInProgress: AuthMethod.link,
      error: undefined,
      successMessage: undefined,
    }),
  ),
  on(
    AuthActions.authenticateWithEmailLinkRequestSent,
    (state: State): State => ({
      ...state,
      inProgress: false,

      error: undefined,
      successMessage: 'Magic link has been sent to your email. Follow it to proceed.',
    }),
  ),
  on(
    AuthActions.restorePasswordAttempt,
    (state: State): State => ({
      ...state,
      inProgress: true,
      error: undefined,
      successMessage: undefined,
    }),
  ),
  on(
    AuthActions.restorePasswordRequestSent,
    (state: State): State => ({
      ...state,
      inProgress: false,

      error: undefined,
      successMessage: 'Check your email for password reset instructions.',
    }),
  ),
  on(
    AuthActions.authenticationFailed,
    (state: State, { errorMessage }): State => ({
      ...state,
      inProgress: false,

      error: {
        message: message,
        code: code,
      },
      successMessage: undefined,
    }),
  ),
  on(
    AuthActions.signedOut,
    (state: State): State => ({
      ...state,
      userId: undefined,
      successMessage: undefined,
    }),
  ),
);

export function reducer(state: State | undefined, action: Action): State {
  return authReducer(state, action);
}
