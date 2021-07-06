import { Action, createReducer, on } from '@ngrx/store';

import * as AuthActions from './auth.actions';

export const AUTH_FEATURE_KEY = 'auth';

export interface State {
  userId?: string;
  isAuthenticating: boolean;
}

export interface AuthPartialState {
  readonly [AUTH_FEATURE_KEY]: State;
}

export const initialState: State = {
  isAuthenticating: true,
};

const authReducer = createReducer<State>(
  initialState,
  on(AuthActions.authenticated, (state: State, { userId }) => ({ ...state, userId, isAuthenticating: false })),
  on(AuthActions.notAuthenticated, (state: State) => ({
    ...state,
    userId: undefined,
    isAuthenticating: false,
  })),
  on(AuthActions.authenticateAnonymously, (state: State) => ({ ...state, isAuthenticating: true })),
);

export function reducer(state: State | undefined, action: Action): State {
  return authReducer(state, action);
}
