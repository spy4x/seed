import { ChangeDetectionStrategy, Component, ViewEncapsulation } from '@angular/core';
import { Store } from '@ngrx/store';
import { AuthMethod, AuthStage, PreviouslyAuthenticatedUser, UserStatus } from '@seed/front/shared/types';
import { AuthUIActions, AuthSelectors } from '@seed/front/shared/auth/state';

@Component({
  selector: 'seed-shared-auth-container-sign-in',
  templateUrl: './sign-in.container.html',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignInContainerComponent {
  inProgress$ = this.store.select(AuthSelectors.getInProgress);

  isAuthenticated$ = this.store.select(AuthSelectors.getIsAuthenticated);

  errorMessage$ = this.store.select(AuthSelectors.getErrorMessage);

  successMessage$ = this.store.select(AuthSelectors.getSuccessMessage);

  authStages = AuthStage;

  authMethods = AuthMethod;

  userStatuses = UserStatus;

  prevUser?: PreviouslyAuthenticatedUser = {
    displayName: 'Anton Shubin',
    phoneNumber: '+79802453603',
    photoURL: 'https://avatars.githubusercontent.com/u/4995814?v=4',
    email: '2spy4x@gmail.com',
  };

  constructor(readonly store: Store) {}

  signIn({ method, email, password }: { method: AuthMethod; email?: string; password?: string }): void {
    switch (method) {
      case AuthMethod.anonymous: {
        return this.store.dispatch(AuthUIActions.signUpAnonymously());
      }
      case AuthMethod.google: {
        return this.store.dispatch(AuthUIActions.authenticateWithGoogle());
      }
      case AuthMethod.github: {
        return this.store.dispatch(AuthUIActions.authenticateWithGitHub());
      }
      case AuthMethod.password: {
        return this.store.dispatch(
          AuthUIActions.signInWithEmailAndPassword({ email: email || '', password: password || '' }),
        );
      }
      case AuthMethod.link: {
        return this.store.dispatch(AuthUIActions.authenticateWithEmailLink({ email: email || '' }));
      }
      default: {
        /* eslint-disable-next-line no-console */
        console.error(`Auth method ${method} is not supported yet.`);
      }
    }
  }

  signUp({ method, password }: { method: AuthMethod; password?: string }): void {
    method;
    return this.store.dispatch(AuthUIActions.signUpWithEmailAndPassword({ email: 'qqq', password: password || '' }));
  }

  enterEmail({ email }: { email: string }): void {
    email;
    // return this.store.dispatch(AuthUIActions.enterEmail({ email }));
  }

  restorePassword(): void {
    return this.store.dispatch(AuthUIActions.restorePassword({ email: 'qqqq' }));
  }

  signOut(): void {
    this.store.dispatch(AuthUIActions.signOut());
  }
}
