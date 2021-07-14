import { createFeatureSelector, createSelector } from '@ngrx/store';
import { AUTH_FEATURE_KEY, State } from './auth.reducer';

export const getAuthState = createFeatureSelector<State>(AUTH_FEATURE_KEY); // Lookup the 'Auth' feature state managed by NgRx

export const getEmail = createSelector(getAuthState, (state: State) => state.email);
export const getInProgress = createSelector(getAuthState, (state: State) => state.inProgress);
export const getIsAuthenticated = createSelector(getAuthState, (state: State) => !!state.userId);
export const getUserId = createSelector(getAuthState, (state: State) => state.userId);
export const getErrorMessage = createSelector(getAuthState, (state: State) => state.error?.message);
export const getSuccessMessage = createSelector(getAuthState, (state: State) => state.successMessage);
