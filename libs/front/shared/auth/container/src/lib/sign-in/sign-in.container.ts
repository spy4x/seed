import { ChangeDetectionStrategy, Component, ViewEncapsulation } from '@angular/core';
import { Store } from '@ngrx/store';
import { AuthProvider, AuthStage, PreviouslyAuthenticatedUser, UserStatus } from '@seed/front/shared/types';
import { AuthUIActions, AuthSelectors } from '@seed/front/shared/auth/state';

@Component({
  selector: 'seed-shared-auth-container-sign-in',
  templateUrl: './sign-in.container.html',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignInContainerComponent {
  stage$ = this.store.select(AuthSelectors.getStage);

  inProgress$ = this.store.select(AuthSelectors.getInProgress);

  email$ = this.store.select(AuthSelectors.getEmail);

  providers$ = this.store.select(AuthSelectors.getProviders);

  selectedProvider$ = this.store.select(AuthSelectors.getSelectedProvider);

  errorMessage$ = this.store.select(AuthSelectors.getErrorMessage);

  successMessage$ = this.store.select(AuthSelectors.getSuccessMessage);

  authStages = AuthStage;

  authMethods = AuthProvider;

  userStatuses = UserStatus;

  prevUser?: PreviouslyAuthenticatedUser = {
    displayName: 'Anton Shubin',
    phoneNumber: '+79802453603',
    photoURL: 'https://avatars.githubusercontent.com/u/4995814?v=4',
    email: '2spy4x@gmail.com',
  };

  constructor(readonly store: Store) {}

  signIn({ method, password }: { method: AuthProvider; password?: string }): void {
    switch (method) {
      case AuthProvider.anonymous: {
        return this.store.dispatch(AuthUIActions.signUpAnonymously());
      }
      case AuthProvider.google: {
        return this.store.dispatch(AuthUIActions.authenticateWithGoogle());
      }
      case AuthProvider.github: {
        return this.store.dispatch(AuthUIActions.authenticateWithGitHub());
      }
      case AuthProvider.password: {
        return this.store.dispatch(AuthUIActions.signInWithEmailAndPassword({ password: password || '' }));
      }
      case AuthProvider.link: {
        return this.store.dispatch(AuthUIActions.authenticateWithEmailLink());
      }
      default: {
        /* eslint-disable-next-line no-console */
        console.error(`Auth method ${method} is not supported yet.`);
      }
    }
  }

  signUp({ method, password }: { method: AuthProvider; password?: string }): void {
    method;
    return this.store.dispatch(AuthUIActions.signUpWithEmailAndPassword({ password: password || '' }));
  }

  enterEmail({ email }: { email: string }): void {
    return this.store.dispatch(AuthUIActions.enterEmail({ email }));
  }

  restorePassword(): void {
    return this.store.dispatch(AuthUIActions.restorePassword());
  }

  signOut(): void {
    this.store.dispatch(AuthUIActions.signOut());
  }

  changeUser(): void {
    this.store.dispatch(AuthUIActions.changeUser());
  }

  chooseProvider(provider?: AuthProvider): void {
    this.store.dispatch(AuthUIActions.chooseProvider({ provider }));
  }
}
