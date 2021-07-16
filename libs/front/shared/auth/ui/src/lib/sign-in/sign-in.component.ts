import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { AuthProvider, AuthStage, PreviouslyAuthenticatedUser } from '@seed/front/shared/types';

@Component({
  selector: 'seed-shared-auth-ui-sign-in',
  templateUrl: './sign-in.component.html',
  styles: [
    `
      .auth-container {
        width: 320px;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignInUIComponent {
  @Input() stage = AuthStage.initialization;

  @Input() inProgress = false;

  @Input() email?: string = undefined;

  @Input() errorMessage?: string = undefined;

  @Input() successMessage?: string = undefined;

  @Input() providers: AuthProvider[] = [];

  @Input() selectedProvider?: AuthProvider = undefined;

  @Input() didUserSignUpEver: boolean = false;

  @Input() prevUser?: PreviouslyAuthenticatedUser = undefined;

  @Output() selectProvider = new EventEmitter<{ method: AuthProvider }>();

  @Output() enterEmail = new EventEmitter<{ email: string }>();

  @Output() signIn = new EventEmitter<{ method: AuthProvider; password?: string; phoneNumber?: string }>();

  @Output() signUp = new EventEmitter<{ method: AuthProvider; password?: string; phoneNumber?: string }>();

  @Output() restorePassword = new EventEmitter<void>();

  @Output() deselectProvider = new EventEmitter<void>();

  @Output() changeUser = new EventEmitter<void>();

  authMethods = AuthProvider;

  authStages = AuthStage;

  allProviders = (Object.keys(AuthProvider) as AuthProvider[]).filter(p => p !== AuthProvider.anonymous);

  onProviderClick(provider: AuthProvider): void {
    switch (provider) {
      case AuthProvider.google:
      case AuthProvider.github:
      case AuthProvider.link:
        return this.signIn.emit({ method: provider });
      case AuthProvider.password:
      case AuthProvider.phone:
        return this.selectProvider.emit({ method: provider });
      default:
        throw new Error('Not implemented');
    }
  }
}
