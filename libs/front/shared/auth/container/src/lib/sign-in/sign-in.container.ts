import { ChangeDetectionStrategy, Component, ViewEncapsulation } from '@angular/core';
import { Store } from '@ngrx/store';
import { AuthMethod, AuthStage, UserStatus } from '@seed/front/shared/types';
import { AuthActions, AuthSelectors } from '@seed/front/shared/auth/state';

@Component({
  selector: 'seed-shared-auth-container-sign-in',
  templateUrl: './sign-in.container.html',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignInContainerComponent {
  inProgress$ = this.store.select(AuthSelectors.getIsAuthenticating);

  isAuthenticated$ = this.store.select(AuthSelectors.getIsAuthenticated);

  errorMessage$ = this.store.select(AuthSelectors.getErrorMessage);

  successMessage$ = this.store.select(AuthSelectors.getSuccessMessage);

  authStages = AuthStage;

  authMethods = AuthMethod;

  userStatuses = UserStatus;

  constructor(readonly store: Store) {}

  signIn({ method, email, password }: { method: AuthMethod; email?: string; password?: string }): void {
    switch (method) {
      case AuthMethod.anonymous: {
        return this.store.dispatch(AuthActions.authenticateAnonymously());
      }
      case AuthMethod.google: {
        return this.store.dispatch(AuthActions.authenticateWithGoogle());
      }
      case AuthMethod.github: {
        return this.store.dispatch(AuthActions.authenticateWithGitHub());
      }
      case AuthMethod.password: {
        return this.store.dispatch(
          AuthActions.authenticateWithEmailAndPassword({ email: email || '', password: password || '' }),
        );
      }
      case AuthMethod.link: {
        return this.store.dispatch(AuthActions.authenticateWithEmailLink({ email: email || '' }));
      }
      default: {
        /* eslint-disable-next-line no-console */
        console.error(`Auth method ${method} is not supported yet.`);
      }
    }
  }

  signUp({ method, password }: { method: AuthMethod; password?: string }): void {
    method;
    return this.store.dispatch(AuthActions.signUpWithEmailAndPassword({ email: 'qqq', password: password || '' }));
  }

  enterEmail({ email }: { email: string }): void {
    email;
    // return this.store.dispatch(AuthActions.enterEmail({ email }));
  }

  restorePassword(): void {
    return this.store.dispatch(AuthActions.restorePasswordAttempt({ email: 'qqqq' }));
  }

  signOut(): void {
    this.store.dispatch(AuthActions.signOut());
  }
}
