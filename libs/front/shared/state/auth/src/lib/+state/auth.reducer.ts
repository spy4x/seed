import { createReducer, on, Action } from '@ngrx/store';
import { EntityState, EntityAdapter, createEntityAdapter } from '@ngrx/entity';

import * as AuthActions from './auth.actions';
import { AuthEntity } from './auth.models';

export const AUTH_FEATURE_KEY = 'auth';

export interface State extends EntityState<AuthEntity> {
  selectedId?: string | number; // which Auth record has been selected
  loaded: boolean; // has the Auth list been loaded
  error?: string | null; // last known error (if any)
}

export interface AuthPartialState {
  readonly [AUTH_FEATURE_KEY]: State;
}

export const authAdapter: EntityAdapter<AuthEntity> = createEntityAdapter<AuthEntity>();

export const initialState: State = authAdapter.getInitialState({
  // set initial required properties
  loaded: false,
});

const authReducer = createReducer(
  initialState,
  on(AuthActions.init, state => ({ ...state, loaded: false, error: null })),
  on(AuthActions.loadAuthSuccess, (state, { auth }) => authAdapter.setAll(auth, { ...state, loaded: true })),
  on(AuthActions.loadAuthFailure, (state, { error }) => ({ ...state, error })),
);

export function reducer(state: State | undefined, action: Action) {
  return authReducer(state, action);
}
