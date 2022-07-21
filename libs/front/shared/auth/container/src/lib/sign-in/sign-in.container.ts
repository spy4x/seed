import { ChangeDetectionStrategy, Component, ViewEncapsulation } from '@angular/core';
import { Store } from '@ngrx/store';
import { AuthProvider, AuthStage } from '@seed/front/shared/types';
import { AuthSelectors, AuthUIActions } from '@seed/front/shared/auth/state';

@Component({
  selector: 'shared-auth-container-sign-in',
  templateUrl: './sign-in.container.html',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignInContainerComponent {
  stage$ = this.store.select(AuthSelectors.getStage);

  inProgress$ = this.store.select(AuthSelectors.getInProgress);

  email$ = this.store.select(AuthSelectors.getEmail);

  displayName$ = this.store.select(AuthSelectors.getDisplayName);

  photoURL$ = this.store.select(AuthSelectors.getPhotoURL);

  userId$ = this.store.select(AuthSelectors.getUserId);

  providers$ = this.store.select(AuthSelectors.getProviders);

  isNewUser$ = this.store.select(AuthSelectors.getIsNewUser);

  selectedProvider$ = this.store.select(AuthSelectors.getSelectedProvider);

  errorMessage$ = this.store.select(AuthSelectors.getErrorMessage);

  successMessage$ = this.store.select(AuthSelectors.getSuccessMessage);

  authStages = AuthStage;

  authProviders = AuthProvider;

  constructor(readonly store: Store) {}

  signIn({ provider, password }: { provider: AuthProvider; password?: string }): void {
    switch (provider) {
      case AuthProvider.anonymous: {
        return this.store.dispatch(AuthUIActions.signAnonymously());
      }
      case AuthProvider.google: {
        return this.store.dispatch(AuthUIActions.signGoogle());
      }
      case AuthProvider.github: {
        return this.store.dispatch(AuthUIActions.signGitHub());
      }
      case AuthProvider.password: {
        return this.store.dispatch(AuthUIActions.signEmailPassword({ password: password || '' }));
      }
      case AuthProvider.link: {
        return this.store.dispatch(AuthUIActions.signEmailLink());
      }
      default: {
        /* eslint-disable-next-line no-console */
        console.error(`Auth provider ${provider} is not supported yet.`);
      }
    }
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

  selectProvider(provider: AuthProvider): void {
    this.store.dispatch(AuthUIActions.selectProvider({ provider }));
  }

  deselectProvider(): void {
    this.store.dispatch(AuthUIActions.deselectProvider());
  }
}
