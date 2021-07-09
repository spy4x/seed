import { Action, createReducer, on } from '@ngrx/store';

import * as AuthActions from './auth.actions';
import { AuthMethods } from '@seed/front/shared/types';

export const AUTH_FEATURE_KEY = 'auth';

export interface State {
  userId?: string;
  isAuthenticating: boolean;
  methodInProgress?: AuthMethods;
  errorMessage?: string;
  successMessage?: string;
}

export interface AuthPartialState {
  readonly [AUTH_FEATURE_KEY]: State;
}

export const initialState: State = {
  isAuthenticating: false,
};

const authReducer = createReducer<State>(
  initialState,
  on(AuthActions.init, (state: State) => ({
    ...state,
    isAuthenticating: true,
    methodInProgress: AuthMethods.init,
    errorMessage: undefined,
    successMessage: undefined,
  })),
  on(
    AuthActions.authenticatedAfterInit,
    AuthActions.authenticatedAfterUserAction,
    AuthActions.signedUp,
    (state: State, { userId }) => ({
      ...state,
      userId,
      isAuthenticating: false,
      methodInProgress: undefined,
      errorMessage: undefined,
      successMessage: undefined,
    }),
  ),
  on(AuthActions.notAuthenticated, (state: State) => ({
    ...state,
    userId: undefined,
    isAuthenticating: false,
    methodInProgress: undefined,
    errorMessage: undefined,
    successMessage: undefined,
  })),
  on(AuthActions.authenticateAnonymously, (state: State) => ({
    ...state,
    isAuthenticating: true,
    methodInProgress: AuthMethods.anonymous,
    errorMessage: undefined,
    successMessage: undefined,
  })),
  on(AuthActions.authenticateWithGoogle, (state: State) => ({
    ...state,
    isAuthenticating: true,
    methodInProgress: AuthMethods.google,
    errorMessage: undefined,
    successMessage: undefined,
  })),
  on(AuthActions.authenticateWithGitHub, (state: State) => ({
    ...state,
    isAuthenticating: true,
    methodInProgress: AuthMethods.github,
    errorMessage: undefined,
    successMessage: undefined,
  })),
  on(AuthActions.authenticateWithEmailAndPassword, AuthActions.signUpWithEmailAndPassword, (state: State) => ({
    ...state,
    isAuthenticating: true,
    methodInProgress: AuthMethods.password,
    errorMessage: undefined,
    successMessage: undefined,
  })),
  on(AuthActions.restorePasswordAttempt, (state: State) => ({
    ...state,
    isAuthenticating: true,
    methodInProgress: AuthMethods.password,
    errorMessage: undefined,
    successMessage: undefined,
  })),
  on(AuthActions.restorePasswordRequestSent, (state: State) => ({
    ...state,
    isAuthenticating: false,
    methodInProgress: undefined,
    errorMessage: undefined,
    successMessage: 'Check your email for password reset instructions.',
  })),
  on(AuthActions.authenticationFailed, (state: State, { errorMessage }) => ({
    ...state,
    isAuthenticating: false,
    methodInProgress: undefined,
    errorMessage,
    successMessage: undefined,
  })),
  on(AuthActions.signedOut, (state: State) => ({
    ...state,
    userId: undefined,
    successMessage: undefined,
  })),
);

export function reducer(state: State | undefined, action: Action): State {
  return authReducer(state, action);
}
