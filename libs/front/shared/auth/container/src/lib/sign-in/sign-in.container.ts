import { ChangeDetectionStrategy, Component, ViewEncapsulation } from '@angular/core';
import { Store } from '@ngrx/store';
import { AuthMethods } from '@seed/front/shared/types';
import { AuthActions, AuthSelectors } from '@seed/front/shared/auth/state';

@Component({
  selector: 'seed-shared-auth-container-sign-in',
  templateUrl: './sign-in.container.html',
  styleUrls: ['./sign-in.container.sass'],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignInContainerComponent {
  isAuthenticating$ = this.store.select(AuthSelectors.getIsAuthenticating);

  isAuthenticated$ = this.store.select(AuthSelectors.getIsAuthenticated);

  constructor(readonly store: Store) {}

  signIn(method: AuthMethods): void {
    switch (method) {
      case AuthMethods.anonymous: {
        return this.store.dispatch(AuthActions.authenticateAnonymously());
      }
      default: {
        /* eslint-disable-next-line no-console */
        console.error(`Auth method ${method} is not supported yet.`);
      }
    }
  }

  signOut(): void {
    this.store.dispatch(AuthActions.signOut());
  }
}
