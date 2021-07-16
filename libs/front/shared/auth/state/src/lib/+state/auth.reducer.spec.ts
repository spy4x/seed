import * as AuthUIActions from './actions/ui.actions';
import * as AuthAPIActions from './actions/api.actions';
import { initialState, reducer, State } from './auth.reducer';
import { testEmail, testPassword } from '@seed/shared/mock-data';
import { AuthProvider, AuthStage } from '@seed/front/shared/types';
import { Action } from '@ngrx/store';

describe('Auth Reducer', () => {
  // region SETUP
  function reducerTest(
    state: undefined | Partial<State> = undefined,
    action: Action,
    stateDiffExpected: Partial<State>,
    checkErrorAndSuccess?: boolean,
  ): void {
    const setErrorAndSuccess: Partial<State> = checkErrorAndSuccess
      ? {
          error: state?.error || { message: 'error' },
          successMessage: state?.successMessage || 'success',
        }
      : {};
    const prevStateFull = { ...initialState, ...state, ...setErrorAndSuccess };
    const nextStateFull = reducer(prevStateFull, action);
    const resetErrorAndSuccess: Partial<State> = checkErrorAndSuccess
      ? {
          error: stateDiffExpected.error || undefined,
          successMessage: stateDiffExpected.successMessage || undefined,
        }
      : {};
    expect(nextStateFull).toEqual({ ...prevStateFull, ...stateDiffExpected, ...resetErrorAndSuccess });
  }

  // endregion

  it('should return the previous state in case of unknown action', () =>
    reducerTest(initialState, {} as any, initialState, false));

  describe('UI Actions', () => {
    it(AuthUIActions.signUpAnonymously.type, () => {
      reducerTest(
        {
          stage: AuthStage.enteringEmail,
          inProgress: false,
        },
        AuthUIActions.signUpAnonymously(),
        {
          inProgress: true,
          stage: AuthStage.authenticatingAnonymously,
          selectedProvider: AuthProvider.anonymous,
        },
      );
    });

    it(AuthUIActions.enterEmail.type, () => {
      reducerTest(
        { stage: AuthStage.enteringEmail, inProgress: false },
        AuthUIActions.enterEmail({ email: testEmail }),
        { email: testEmail },
      );
    });

    it(AuthUIActions.changeUser.type, () => {
      reducerTest(
        {
          stage: AuthStage.authenticatingWithEmailAndPassword,
          email: testEmail,
          providers: [AuthProvider.password],
          selectedProvider: AuthProvider.password,
        },
        AuthUIActions.changeUser(),
        {
          stage: AuthStage.enteringEmail,
          email: undefined,
          providers: [],
          selectedProvider: undefined,
        },
      );
    });

    it(AuthUIActions.chooseProvider.type, () => {
      reducerTest(
        {
          stage: AuthStage.choosingProvider,
          email: testEmail,
          providers: [AuthProvider.password, AuthProvider.link],
          selectedProvider: undefined,
        },
        AuthUIActions.chooseProvider({ provider: AuthProvider.password }),
        {
          selectedProvider: AuthProvider.password,
        },
      );
    });

    it(AuthUIActions.authenticateWithGoogle.type, () => {
      reducerTest(
        {
          stage: AuthStage.choosingProvider,
          email: testEmail,
          providers: [AuthProvider.google, AuthProvider.link],
          inProgress: false,
          selectedProvider: AuthProvider.google,
        },
        AuthUIActions.authenticateWithGoogle(),
        {
          stage: AuthStage.authenticatingWithGoogle,
          inProgress: true,
        },
      );
    });

    it(AuthUIActions.authenticateWithGitHub.type, () => {
      reducerTest(
        {
          stage: AuthStage.choosingProvider,
          email: testEmail,
          providers: [AuthProvider.github, AuthProvider.link],
          inProgress: false,
          selectedProvider: AuthProvider.github,
        },
        AuthUIActions.authenticateWithGitHub(),
        {
          stage: AuthStage.authenticatingWithGitHub,
          inProgress: true,
        },
      );
    });

    it(AuthUIActions.authenticateWithEmailLink.type, () => {
      reducerTest(
        {
          stage: AuthStage.choosingProvider,
          email: testEmail,
          providers: [AuthProvider.github, AuthProvider.link],
          inProgress: false,
          selectedProvider: AuthProvider.link,
        },
        AuthUIActions.authenticateWithEmailLink(),
        {
          stage: AuthStage.authenticatingWithEmailLink,
          inProgress: true,
        },
      );
    });

    it(AuthUIActions.signInWithEmailAndPassword.type, () => {
      reducerTest(
        {
          stage: AuthStage.authenticatingWithEmailAndPassword,
          email: testEmail,
          providers: [AuthProvider.github, AuthProvider.password],
          inProgress: false,
          selectedProvider: AuthProvider.password,
        },
        AuthUIActions.signInWithEmailAndPassword({ password: testPassword }),
        {
          inProgress: true,
        },
      );
    });

    it(AuthUIActions.signUpWithEmailAndPassword.type, () => {
      reducerTest(
        {
          stage: AuthStage.authenticatingWithEmailAndPassword,
          email: testEmail,
          providers: [AuthProvider.github, AuthProvider.password],
          inProgress: false,
          selectedProvider: AuthProvider.password,
        },
        AuthUIActions.signUpWithEmailAndPassword({ password: testPassword }),
        {
          inProgress: true,
        },
      );
    });

    it(AuthUIActions.restorePassword.type, () => {
      reducerTest(
        {
          stage: AuthStage.authenticatingWithEmailAndPassword,
          email: testEmail,
          providers: [AuthProvider.github, AuthProvider.password],
          inProgress: false,
          selectedProvider: AuthProvider.password,
        },
        AuthUIActions.restorePassword(),
        {
          stage: AuthStage.restoringPassword,
          inProgress: true,
        },
      );
    });

    it(AuthUIActions.signOut.type, () => {
      reducerTest(
        {
          stage: AuthStage.signedIn,
          email: testEmail,
          userId: '123',
          providers: [AuthProvider.github, AuthProvider.password],
          inProgress: false,
          selectedProvider: AuthProvider.password,
        },
        AuthUIActions.signOut(),
        {
          stage: AuthStage.signingOut,
          inProgress: true,
        },
      );
    });
  });

  describe('API Actions', () => {
    it(AuthAPIActions.init.type, () => {
      reducerTest({}, AuthAPIActions.init(), {
        inProgress: true,
        stage: AuthStage.initialization,
      });
    });

    it(AuthAPIActions.initAuthenticated.type, () => {
      reducerTest(
        { stage: AuthStage.initialization, inProgress: true },
        AuthAPIActions.initAuthenticated({ userId: '123' }),
        {
          inProgress: false,
          stage: AuthStage.signedIn,
          userId: '123',
        },
      );
    });

    it(AuthAPIActions.initNotAuthenticated.type, () => {
      reducerTest({ stage: AuthStage.initialization, inProgress: true }, AuthAPIActions.initNotAuthenticated(), {
        inProgress: false,
        stage: AuthStage.enteringEmail,
      });
    });

    it(AuthAPIActions.fetchProviders.type, () => {
      reducerTest({ stage: AuthStage.enteringEmail, email: testEmail }, AuthAPIActions.fetchProviders(), {
        inProgress: true,
        stage: AuthStage.fetchingProviders,
      });
    });

    it(`"${AuthAPIActions.fetchProvidersSuccess.type}": saves multiple providers (user exists in Auth DB)"`, () => {
      const providers = [AuthProvider.password, AuthProvider.google];
      reducerTest(
        {
          email: testEmail,
          stage: AuthStage.fetchingProviders,
          providers: undefined,
          inProgress: true,
        },
        AuthAPIActions.fetchProvidersSuccess({ providers }),
        {
          inProgress: false,
          stage: AuthStage.choosingProvider,
          providers,
        },
      );
    });

    it(`"${AuthAPIActions.fetchProvidersSuccess.type}": saves zero providers (user doesn't exist in Auth DB)`, () => {
      const providers = [AuthProvider.password, AuthProvider.google];
      reducerTest(
        {
          email: testEmail,
          stage: AuthStage.fetchingProviders,
          providers: [],
          inProgress: true,
        },
        AuthAPIActions.fetchProvidersSuccess({ providers }),
        {
          inProgress: false,
          stage: AuthStage.choosingProvider,
          providers,
        },
      );
    });

    it(AuthAPIActions.signedUp.type, () => {
      reducerTest(
        {
          stage: AuthStage.authenticatingWithEmailAndPassword,
          email: testEmail,

          providers: [AuthProvider.password],
          inProgress: true,
          selectedProvider: AuthProvider.password,
        },
        AuthAPIActions.signedUp({ userId: '123' }),
        {
          inProgress: false,
          stage: AuthStage.signedIn,
          userId: '123',
        },
      );
    });

    it(AuthAPIActions.authenticateWithEmailLinkRequestSent.type, () => {
      reducerTest(
        {
          stage: AuthStage.authenticatingWithEmailLink,
          email: testEmail,

          providers: [AuthProvider.link],
          inProgress: true,
          selectedProvider: AuthProvider.link,
        },
        AuthAPIActions.authenticateWithEmailLinkRequestSent(),
        {
          inProgress: false,
          successMessage: 'Magic link has been sent to your email. Follow it to proceed.',
        },
      );
    });

    it(AuthAPIActions.authenticateWithEmailLinkFinish.type, () => {
      reducerTest(
        {
          stage: AuthStage.initialization,
          inProgress: true,
        },
        AuthAPIActions.authenticateWithEmailLinkFinish(),
        {
          inProgress: true,
          stage: AuthStage.authenticatingWithEmailLink,
          selectedProvider: AuthProvider.link,
        },
      );
    });

    it(AuthAPIActions.restorePasswordSuccess.type, () => {
      reducerTest(
        {
          stage: AuthStage.restoringPassword,
          email: testEmail,

          providers: [AuthProvider.password],
          selectedProvider: AuthProvider.password,
          inProgress: true,
        },
        AuthAPIActions.restorePasswordSuccess(),
        {
          inProgress: false,
          successMessage: 'Check your email for password reset instructions.',
        },
      );
    });

    it(AuthAPIActions.authenticated.type, () => {
      reducerTest(
        {
          stage: AuthStage.authenticatingWithGoogle,
          email: testEmail,

          providers: [AuthProvider.google],
          selectedProvider: AuthProvider.google,
          inProgress: true,
        },
        AuthAPIActions.authenticated({ userId: '123' }),
        {
          inProgress: false,
          userId: '123',
          stage: AuthStage.signedIn,
        },
      );
    });

    it(AuthAPIActions.actionFailed.type, () => {
      const error = { message: 'Wrong password', code: 'auth/wrong-pass' };
      reducerTest(
        {
          stage: AuthStage.authenticatingWithEmailAndPassword,
          selectedProvider: AuthProvider.password,
          email: testEmail,
          inProgress: true,
        },
        AuthAPIActions.actionFailed(error),
        {
          inProgress: false,
          error,
        },
      );
    });

    it(AuthAPIActions.signedOut.type, () => {
      reducerTest(
        {
          selectedProvider: AuthProvider.google,
          email: testEmail,
          providers: [AuthProvider.google],
          userId: '123',
          stage: AuthStage.signingOut,
          inProgress: true,
        },
        AuthAPIActions.signedOut(),
        {
          userId: undefined,
          selectedProvider: undefined,
          email: undefined,
          providers: [],
          stage: AuthStage.enteringEmail,
          inProgress: false,
        },
      );
    });
  });
});
