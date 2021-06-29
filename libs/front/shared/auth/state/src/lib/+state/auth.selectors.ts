import { createFeatureSelector, createSelector } from '@ngrx/store';
import { AUTH_FEATURE_KEY, State } from './auth.reducer';

// Lookup the 'Auth' feature state managed by NgRx
export const getAuthState = createFeatureSelector<State>(AUTH_FEATURE_KEY);
export const getIsAuthenticating = createSelector(getAuthState, (state: State) => state.isAuthenticating);
export const getIsAuthenticated = createSelector(getAuthState, (state: State) => !!state.userId);
export const getUserId = createSelector(getAuthState, (state: State) => state.userId);
