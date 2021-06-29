import { ChangeDetectionStrategy, Component, ViewEncapsulation } from '@angular/core';
import { AuthActions, AuthSelectors } from '@seed/front/shared/state/auth';
import { Store } from '@ngrx/store';
import { AuthMethods } from '@seed/front/shared/types';

@Component({
  selector: 'seed-shared-containers-auth-sign-in',
  templateUrl: './sign-in.container.html',
  styleUrls: ['./sign-in.container.sass'],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignInContainer {
  isIsAuthenticating$ = this.store.select(AuthSelectors.getIsAuthenticating);
  isIsAuthenticated$ = this.store.select(AuthSelectors.getIsAuthenticated);

  constructor(private store: Store) {}

  signIn(method: AuthMethods): void {
    switch (method) {
      case AuthMethods.anonymous: {
        return this.store.dispatch(AuthActions.authenticateAnonymously());
      }
      default: {
        console.log(`Auth method ${method} is not supported yet.`);
        return;
      }
    }
  }

  signOut(): void {
    this.store.dispatch(AuthActions.signOut());
  }
}
