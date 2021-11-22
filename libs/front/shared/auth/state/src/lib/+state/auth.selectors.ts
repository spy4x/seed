import { createFeatureSelector, createSelector } from '@ngrx/store';
import { AUTH_FEATURE_KEY, State } from './auth.reducer';
import { ZERO } from '@seed/shared/constants';
import { AuthStage } from '@seed/front/shared/types';

export const getAuthState = createFeatureSelector<State>(AUTH_FEATURE_KEY); // Lookup the 'Auth' feature state managed by NgRx

export const getStage = createSelector(getAuthState, (state: State) => state.stage);
export const getInProgress = createSelector(getAuthState, (state: State) => state.inProgress);
export const getOriginalUrl = createSelector(getAuthState, (state: State) => state.originalURL);
export const getEmail = createSelector(getAuthState, (state: State) => state.email);
export const getDisplayName = createSelector(getAuthState, (state: State) => state.displayName);
export const getPhotoURL = createSelector(getAuthState, (state: State) => state.photoURL);
export const getProviders = createSelector(getAuthState, (state: State) => state.providers);
export const getIsNewUser = createSelector(getAuthState, (state: State) => {
  if (state.isNewUser) {
    return true;
  }
  if (state.isNewUser === false) {
    return false;
  }
  if (!state.providers) {
    return undefined;
  }
  return state.providers.length === ZERO;
});
export const getEmailPasswordPayload = createSelector(getEmail, getIsNewUser, (email, isNewUser) => ({
  email: email ? email : '',
  isNewUser: !!isNewUser,
}));
export const getSelectedProvider = createSelector(getAuthState, (state: State) => state.selectedProvider);
export const getUserId = createSelector(getAuthState, (state: State) => state.userId);
export const getErrorMessage = createSelector(getAuthState, (state: State) => state.error?.message);
export const getSuccessMessage = createSelector(getAuthState, (state: State) => state.successMessage);
export const getJWT = createSelector(getAuthState, (state: State) => state.jwt);
export const getIsAuthorized = createSelector(getAuthState, (state: State) => state.stage === AuthStage.authorized);
