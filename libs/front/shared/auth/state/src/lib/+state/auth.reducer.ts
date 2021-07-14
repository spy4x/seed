import { Action, createReducer, on } from '@ngrx/store';
import * as AuthUIActions from './actions/ui.actions';
import * as AuthAPIActions from './actions/api.actions';
import { AuthMethod, AuthStage, PreviouslyAuthenticatedUser } from '@seed/front/shared/types';

export const AUTH_FEATURE_KEY = 'auth';

export interface State {
  stage: AuthStage;
  prevUser?: PreviouslyAuthenticatedUser;
  email?: string;
  userId?: string;
  inProgress: boolean;
  providers: AuthMethod[];
  selectedProvider?: AuthMethod;
  error?: {
    message: string;
    code?: string;
  };
  successMessage?: string;
}

export interface AuthPartialState {
  readonly [AUTH_FEATURE_KEY]: State;
}

export const initialState: State = {
  stage: AuthStage.init,
  prevUser: undefined,
  email: undefined,
  userId: undefined,
  inProgress: false,
  providers: [],
  selectedProvider: undefined,
  error: undefined,
  successMessage: undefined,
};

const resetErrorAndSuccess = {
  error: undefined,
  successMessage: undefined,
};

const authReducer = createReducer<State>(
  initialState,

  // region UI Actions
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
      stage: AuthStage.enterEmail,
      prevUser: undefined,
      email: undefined,
      providers: [],
      selectedProvider: undefined,
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
      stage: AuthStage.init,
      ...resetErrorAndSuccess,
    }),
  ),
  // endregion

  // region OLD BELOW

  on(
    AuthAPIActions.initAuthenticated,
    AuthAPIActions.authenticated,
    AuthAPIActions.signedUp,
    (state: State, { userId }): State => ({
      ...state,
      userId,
      inProgress: false,
      ...resetErrorAndSuccess,
    }),
  ),
  on(
    AuthAPIActions.initNotAuthenticated,
    (state: State): State => ({
      ...state,
      userId: undefined,
      inProgress: false,
      ...resetErrorAndSuccess,
    }),
  ),
  on(
    AuthUIActions.signUpAnonymously,
    (state: State): State => ({
      ...state,
      inProgress: true,
      selectedProvider: AuthMethod.anonymous,
      ...resetErrorAndSuccess,
    }),
  ),
  on(
    AuthUIActions.authenticateWithGoogle,
    (state: State): State => ({
      ...state,
      inProgress: true,
      ...resetErrorAndSuccess,
    }),
  ),
  on(
    AuthUIActions.authenticateWithGitHub,
    (state: State): State => ({
      ...state,
      inProgress: true,
      ...resetErrorAndSuccess,
    }),
  ),
  on(
    AuthUIActions.signInWithEmailAndPassword,
    AuthUIActions.signUpWithEmailAndPassword,
    (state: State): State => ({
      ...state,
      inProgress: true,
      ...resetErrorAndSuccess,
    }),
  ),
  on(
    AuthUIActions.authenticateWithEmailLink,
    (state: State): State => ({
      ...state,
      inProgress: true,
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
    AuthUIActions.restorePassword,
    (state: State): State => ({
      ...state,
      inProgress: true,
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
      userId: undefined,
      ...resetErrorAndSuccess,
    }),
  ),
  // endregion
);

export function reducer(state: State | undefined, action: Action): State {
  return authReducer(state, action);
}
