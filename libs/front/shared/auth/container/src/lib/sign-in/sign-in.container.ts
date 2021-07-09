import { ChangeDetectionStrategy, Component, ViewEncapsulation } from '@angular/core';
import { Store } from '@ngrx/store';
import { AuthMethods } from '@seed/front/shared/types';
import { AuthActions, AuthSelectors } from '@seed/front/shared/auth/state';

@Component({
  selector: 'seed-shared-auth-container-sign-in',
  templateUrl: './sign-in.container.html',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignInContainerComponent {
  isAuthenticating$ = this.store.select(AuthSelectors.getIsAuthenticating);

  isAuthenticated$ = this.store.select(AuthSelectors.getIsAuthenticated);

  errorMessage$ = this.store.select(AuthSelectors.getErrorMessage);

  successMessage$ = this.store.select(AuthSelectors.getSuccessMessage);

  constructor(readonly store: Store) {}

  signIn({ method, email, password }: { method: AuthMethods; email?: string; password?: string }): void {
    switch (method) {
      case AuthMethods.anonymous: {
        return this.store.dispatch(AuthActions.authenticateAnonymously());
      }
      case AuthMethods.google: {
        return this.store.dispatch(AuthActions.authenticateWithGoogle());
      }
      case AuthMethods.github: {
        return this.store.dispatch(AuthActions.authenticateWithGitHub());
      }
      case AuthMethods.password: {
        return this.store.dispatch(
          AuthActions.authenticateWithEmailAndPassword({ email: email || '', password: password || '' }),
        );
      }
      default: {
        /* eslint-disable-next-line no-console */
        console.error(`Auth method ${method} is not supported yet.`);
      }
    }
  }

  signUp({ email, password }: { email: string; password: string }): void {
    return this.store.dispatch(
      AuthActions.signUpWithEmailAndPassword({ email: email || '', password: password || '' }),
    );
  }

  restorePassword({ email }: { email: string }): void {
    return this.store.dispatch(AuthActions.restorePasswordAttempt({ email }));
  }

  signOut(): void {
    this.store.dispatch(AuthActions.signOut());
  }
}
