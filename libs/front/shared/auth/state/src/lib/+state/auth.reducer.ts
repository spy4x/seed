import { Action, createReducer, on } from '@ngrx/store';

import * as AuthActions from './auth.actions';
import { AuthMethods } from '@seed/front/shared/types';

export const AUTH_FEATURE_KEY = 'auth';

export interface State {
  userId?: string;
  isAuthenticating: boolean;
  methodInProgress?: AuthMethods;
  errorMessage?: string;
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
  })),
  on(
    AuthActions.authenticatedAfterInit,
    AuthActions.authenticatedAfterUserAction,
    AuthActions.signedUp,
    (state: State, { userId }) => ({
      ...state,
      userId,
      isAuthenticating: false,
      errorMessage: undefined,
      methodInProgress: undefined,
    }),
  ),
  on(AuthActions.notAuthenticated, (state: State) => ({
    ...state,
    userId: undefined,
    isAuthenticating: false,
    errorMessage: undefined,
    methodInProgress: undefined,
  })),
  on(AuthActions.authenticateAnonymously, (state: State) => ({
    ...state,
    isAuthenticating: true,
    errorMessage: undefined,
    methodInProgress: AuthMethods.anonymous,
  })),
  on(AuthActions.authenticateWithGoogle, (state: State) => ({
    ...state,
    isAuthenticating: true,
    errorMessage: undefined,
    methodInProgress: AuthMethods.google,
  })),
  on(AuthActions.authenticateWithGitHub, (state: State) => ({
    ...state,
    isAuthenticating: true,
    errorMessage: undefined,
    methodInProgress: AuthMethods.github,
  })),
  on(AuthActions.authenticateWithEmailAndPassword, AuthActions.signUpWithEmailAndPassword, (state: State) => ({
    ...state,
    isAuthenticating: true,
    errorMessage: undefined,
    methodInProgress: AuthMethods.password,
  })),
  on(AuthActions.authenticationFailed, (state: State, { errorMessage }) => ({
    ...state,
    isAuthenticating: false,
    errorMessage,
    methodInProgress: undefined,
  })),
  on(AuthActions.signedOut, (state: State) => ({
    ...state,
    userId: undefined,
  })),
);

export function reducer(state: State | undefined, action: Action): State {
  return authReducer(state, action);
}
