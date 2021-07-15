import { Action, createReducer, on } from '@ngrx/store';
import * as AuthUIActions from './actions/ui.actions';
import * as AuthAPIActions from './actions/api.actions';
import { AuthProvider, AuthStage } from '@seed/front/shared/types';

export const AUTH_FEATURE_KEY = 'auth';

export interface State {
  stage: AuthStage;
  inProgress: boolean;
  successMessage?: string;
  error?: {
    message: string;
    code?: string;
  };

  email?: string;
  providers: AuthProvider[];
  selectedProvider?: AuthProvider;
  userId?: string;
}

export interface AuthPartialState {
  readonly [AUTH_FEATURE_KEY]: State;
}

export const initialState: State = {
  stage: AuthStage.initialization,
  inProgress: false,
  successMessage: undefined,
  error: undefined,

  email: undefined,
  providers: [],
  selectedProvider: undefined,
  userId: undefined,
};

const resetErrorAndSuccess = {
  error: undefined,
  successMessage: undefined,
};

const authReducer = createReducer<State>(
  initialState,

  // region UI Actions
  on(
    AuthUIActions.signUpAnonymously,
    (state: State): State => ({
      ...state,
      inProgress: true,
      stage: AuthStage.authenticatingAnonymously,
      selectedProvider: AuthProvider.anonymous,
      ...resetErrorAndSuccess,
    }),
  ),
  on(
    AuthUIActions.enterEmail,
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
      providers: [],
      selectedProvider: undefined,
      ...resetErrorAndSuccess,
    }),
  ),
  on(
    AuthUIActions.chooseProvider,
    (state: State, { provider }): State => ({
      ...state,
      selectedProvider: provider,
      ...resetErrorAndSuccess,
    }),
  ),
  on(
    AuthUIActions.authenticateWithGoogle,
    (state: State): State => ({
      ...state,
      inProgress: true,
      stage: AuthStage.authenticatingWithGoogle,
      ...resetErrorAndSuccess,
    }),
  ),
  on(
    AuthUIActions.authenticateWithGitHub,
    (state: State): State => ({
      ...state,
      inProgress: true,
      stage: AuthStage.authenticatingWithGitHub,
      ...resetErrorAndSuccess,
    }),
  ),
  on(
    AuthUIActions.signInWithEmailAndPassword,
    AuthUIActions.signUpWithEmailAndPassword,
    (state: State): State => ({
      ...state,
      inProgress: true,
      stage: AuthStage.authenticatingWithEmailAndPassword,
      ...resetErrorAndSuccess,
    }),
  ),
  on(
    AuthUIActions.authenticateWithEmailLink,
    (state: State): State => ({
      ...state,
      inProgress: true,
      stage: AuthStage.authenticatingWithEmailLink,
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
    AuthAPIActions.initAuthenticated,
    AuthAPIActions.authenticated,
    AuthAPIActions.signedUp,
    (state: State, { userId }): State => ({
      ...state,
      userId,
      stage: AuthStage.signedIn,
      inProgress: false,
      ...resetErrorAndSuccess,
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
    AuthAPIActions.authenticateWithEmailLinkRequestSent,
    (state: State): State => ({
      ...state,
      inProgress: false,
      ...resetErrorAndSuccess,
      successMessage: 'Magic link has been sent to your email. Follow it to proceed.',
    }),
  ),
  on(
    AuthAPIActions.authenticateWithEmailLinkFinish,
    (state: State): State => ({
      ...state,
      inProgress: true,
      stage: AuthStage.authenticatingWithEmailLink,
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
        message: message,
        code: code,
      },
    }),
  ),
  on(
    AuthAPIActions.signedOut,
    (state: State): State => ({
      ...state,
      stage: AuthStage.enteringEmail,
      inProgress: false,
      userId: undefined,
      providers: [],
      selectedProvider: undefined,
      email: undefined,
      ...resetErrorAndSuccess,
    }),
  ),
  // endregion
);

export function reducer(state: State | undefined, action: Action): State {
  return authReducer(state, action);
}
