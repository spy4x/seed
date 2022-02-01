import { Action, createReducer, on } from '@ngrx/store';
import * as AuthUIActions from './actions/ui.actions';
import * as AuthAPIActions from './actions/api.actions';
import { AuthProvider, AuthStage } from '@seed/front/shared/types';
import type { User } from '@prisma/client';

export const AUTH_FEATURE_KEY = 'auth';

export interface State {
  stage: AuthStage;
  inProgress: boolean;
  successMessage?: string;
  error?: {
    message: string;
    code?: string;
  };
  originalURL?: string;

  email?: string;
  /**
   * Values meaning:
   * undefined - we don't know yet if user exist in Firebase Authentication DB. We need to fetch providers by email.
   * [] (empty array) - user with the email doesn't exist in Firebase Authentication DB (not signed up yet).
   * [...] (array with list of providers) - user with the email exists in Firebase Authentication DB.
   */
  providers?: AuthProvider[];
  selectedProvider?: AuthProvider;
  isNewUser?: boolean;
  isEmailVerified?: boolean;
  userId?: string;
  displayName?: string;
  photoURL?: string;
  createdAt?: number;
  jwt?: string;

  user?: User;
}

export interface AuthPartialState {
  readonly [AUTH_FEATURE_KEY]: State;
}

export const initialState: State = {
  stage: AuthStage.initialization,
  inProgress: false,
  successMessage: undefined,
  error: undefined,
  originalURL: undefined,

  email: undefined,
  providers: undefined,
  selectedProvider: undefined,
  isNewUser: undefined,
  isEmailVerified: undefined,
  userId: undefined,
  displayName: undefined,
  photoURL: undefined,
  createdAt: undefined,
  jwt: undefined,

  user: undefined,
};

const resetErrorAndSuccess = {
  error: undefined,
  successMessage: undefined,
};

const authReducer = createReducer<State>(
  initialState,

  // region UI Actions
  on(
    AuthUIActions.signAnonymously,
    (state: State): State => ({
      ...state,
      inProgress: true,
      stage: AuthStage.signingAnonymously,
      selectedProvider: AuthProvider.anonymous,
      ...resetErrorAndSuccess,
    }),
  ),
  on(
    AuthUIActions.enterEmail,
    AuthAPIActions.enterEmail,
    (state: State, { email }): State => ({
      ...state,
      email,
      ...resetErrorAndSuccess,
    }),
  ),
  on(
    AuthUIActions.changeUser,
    (state: State): State => ({
      ...state,
      stage: AuthStage.enteringEmail,
      email: undefined,
      displayName: undefined,
      photoURL: undefined,
      providers: [],
      selectedProvider: undefined,
      ...resetErrorAndSuccess,
    }),
  ),
  on(AuthUIActions.selectProvider, (state: State, { provider }): State => {
    const stageUpdate: Partial<State> = {};
    if (provider === AuthProvider.password) {
      stageUpdate.stage = AuthStage.signingEmailAndPassword;
    }
    if (provider === AuthProvider.phone) {
      stageUpdate.stage = AuthStage.signingPhoneNumber;
    }
    return {
      ...state,
      selectedProvider: provider,
      ...stageUpdate,
      ...resetErrorAndSuccess,
    };
  }),
  on(AuthUIActions.deselectProvider, (state: State): State => {
    const stageUpdate: Partial<State> = {};
    if (state.stage === AuthStage.signingEmailAndPassword || state.stage === AuthStage.signingPhoneNumber) {
      stageUpdate.stage = AuthStage.choosingProvider;
    }
    return {
      ...state,
      selectedProvider: undefined,
      ...stageUpdate,
      ...resetErrorAndSuccess,
    };
  }),
  on(
    AuthUIActions.signGoogle,
    (state: State): State => ({
      ...state,
      inProgress: true,
      stage: AuthStage.signingGoogle,
      ...resetErrorAndSuccess,
    }),
  ),
  on(
    AuthUIActions.signGitHub,
    (state: State): State => ({
      ...state,
      inProgress: true,
      stage: AuthStage.signingGitHub,
      ...resetErrorAndSuccess,
    }),
  ),
  on(
    AuthUIActions.signEmailPassword,
    (state: State): State => ({
      ...state,
      inProgress: true,
      stage: AuthStage.signingEmailAndPassword,
      ...resetErrorAndSuccess,
    }),
  ),
  on(
    AuthUIActions.signEmailLink,
    (state: State): State => ({
      ...state,
      inProgress: true,
      stage: AuthStage.signingEmailLink,
      ...resetErrorAndSuccess,
    }),
  ),
  on(
    AuthUIActions.restorePassword,
    (state: State): State => ({
      ...state,
      inProgress: true,
      stage: AuthStage.restoringPassword,
      ...resetErrorAndSuccess,
    }),
  ),
  on(
    AuthUIActions.signOut,
    (state: State): State => ({
      ...state,
      stage: AuthStage.signingOut,
      inProgress: true,
      ...resetErrorAndSuccess,
    }),
  ),
  // endregion

  // region API Actions
  on(
    AuthAPIActions.init,
    (state: State): State => ({
      ...state,
      inProgress: true,
      stage: AuthStage.initialization,
      ...resetErrorAndSuccess,
    }),
  ),
  on(
    AuthAPIActions.saveOriginalURL,
    (state: State, { url }): State => ({
      ...state,
      originalURL: url,
      ...resetErrorAndSuccess,
    }),
  ),
  on(
    AuthAPIActions.initSignedIn,
    AuthAPIActions.signedIn,
    AuthAPIActions.signedUp,
    (
      state: State,
      { userId, email, displayName, photoURL, isNewUser, createdAt, isEmailVerified, providers, jwt },
    ): State => ({
      ...state,
      stage: AuthStage.loadingProfile,
      inProgress: false,
      userId,
      email,
      displayName,
      photoURL,
      isNewUser,
      isEmailVerified,
      createdAt,
      providers,
      jwt,
      ...resetErrorAndSuccess,
    }),
  ),
  on(
    AuthAPIActions.signedUp,
    (state: State): State => ({
      ...state,
      ...resetErrorAndSuccess,
      stage: AuthStage.creatingProfile,
      successMessage: `You've successfully signed up! Feel free to explore the app 🎉`,
    }),
  ),
  on(
    AuthAPIActions.initNotAuthenticated,
    (state: State): State => ({
      ...state,
      inProgress: false,
      stage: AuthStage.enteringEmail,
      ...resetErrorAndSuccess,
    }),
  ),
  on(
    AuthAPIActions.initNotAuthenticatedButRehydrateState,
    (state: State, { email, displayName, photoURL }): State => ({
      ...state,
      inProgress: false,
      stage: AuthStage.enteringEmail,
      email,
      displayName,
      photoURL,
      ...resetErrorAndSuccess,
    }),
  ),
  on(
    AuthAPIActions.fetchProviders,
    (state: State): State => ({
      ...state,
      inProgress: true,
      stage: AuthStage.fetchingProviders,
      ...resetErrorAndSuccess,
    }),
  ),
  on(
    AuthAPIActions.fetchProvidersSuccess,
    (state: State, { providers }): State => ({
      ...state,
      inProgress: false,
      stage: AuthStage.choosingProvider,
      providers,
      ...resetErrorAndSuccess,
    }),
  ),
  on(
    AuthAPIActions.signEmailLinkRequestSent,
    (state: State): State => ({
      ...state,
      inProgress: false,
      ...resetErrorAndSuccess,
      successMessage: 'Magic link has been sent to your email. Follow it to proceed.',
    }),
  ),
  on(
    AuthAPIActions.signEmailLinkFinish,
    (state: State): State => ({
      ...state,
      inProgress: true,
      stage: AuthStage.signingEmailLink,
      selectedProvider: AuthProvider.link,
      ...resetErrorAndSuccess,
    }),
  ),
  on(
    AuthAPIActions.restorePasswordSuccess,
    (state: State): State => ({
      ...state,
      inProgress: false,
      ...resetErrorAndSuccess,
      successMessage: 'Check your email for password reset instructions.',
    }),
  ),
  on(
    AuthAPIActions.actionFailed,
    (state: State, { message, code }): State => ({
      ...state,
      inProgress: false,
      ...resetErrorAndSuccess,
      error: {
        message,
        code,
      },
    }),
  ),
  on(
    AuthAPIActions.signedOut,
    (state: State): State => ({
      ...state,
      ...initialState,
      stage: AuthStage.enteringEmail,
      inProgress: false,
      ...resetErrorAndSuccess,
    }),
  ),
  on(
    AuthAPIActions.profileLoadSuccessNoProfileYet,
    (state: State): State => ({
      ...state,
      ...resetErrorAndSuccess,
      stage: AuthStage.creatingProfile,
      inProgress: false,
    }),
  ),
  on(
    AuthAPIActions.profileLoadSuccess,
    (state: State, { user }): State => ({
      ...state,
      ...resetErrorAndSuccess,
      stage: AuthStage.authorizing,
      inProgress: true,
      user,
    }),
  ),
  on(
    AuthAPIActions.profileCreateSuccess,
    (state: State, { user }): State => ({
      ...state,
      ...resetErrorAndSuccess,
      stage: AuthStage.authorizing,
      inProgress: true,
      user,
    }),
  ),
  on(
    AuthAPIActions.authorized,
    (state: State): State => ({
      ...state,
      ...resetErrorAndSuccess,
      stage: AuthStage.authorized,
      inProgress: false,
    }),
  ),
  on(
    AuthAPIActions.notAuthorized,
    (state: State, { reason }): State => ({
      ...state,
      ...resetErrorAndSuccess,
      stage: AuthStage.notAuthorized,
      inProgress: false,
      error: {
        message: reason,
      },
    }),
  ),
  on(
    AuthAPIActions.setJWT,
    (state: State, { jwt }): State => ({
      ...state,
      jwt,
    }),
  ),
  // endregion
);

export function reducer(state: State | undefined, action: Action): State {
  return authReducer(state, action);
}
