import { createFeatureSelector, createSelector } from '@ngrx/store';
import { AUTH_FEATURE_KEY, State } from './auth.reducer';
import { AuthStage } from '@seed/front/shared/types';

export const getAuthState = createFeatureSelector<State>(AUTH_FEATURE_KEY); // Lookup the 'Auth' feature state managed by NgRx

export const getStage = createSelector(getAuthState, (state: State) => state.stage);
export const getInProgress = createSelector(getAuthState, (state: State) => state.inProgress);
export const getEmail = createSelector(getAuthState, (state: State) => state.email);
export const getProviders = createSelector(getAuthState, (state: State) => state.providers);
export const getSelectedProvider = createSelector(getAuthState, (state: State) => state.selectedProvider);

export const getIsAuthenticated = createSelector(getAuthState, (state: State) => state.stage === AuthStage.signedIn);
export const getUserId = createSelector(getAuthState, (state: State) => state.userId);
export const getErrorMessage = createSelector(getAuthState, (state: State) => state.error?.message);
export const getSuccessMessage = createSelector(getAuthState, (state: State) => state.successMessage);
