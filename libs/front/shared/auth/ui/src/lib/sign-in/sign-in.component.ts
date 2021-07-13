import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { AuthMethod, AuthStage, UserStatus } from '@seed/front/shared/types';
import { SharedAuthUIPrevUser } from '../prevUser.interface';

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
  @Input() stage = AuthStage.init;

  @Input() inProgress = false;

  @Input() email?: string = undefined;

  @Input() errorMessage?: string = undefined;

  @Input() successMessage?: string = undefined;

  @Input() providers: AuthMethod[] = [];

  @Input() selectedProvider?: AuthMethod = undefined;

  @Input() userStatus?: UserStatus = undefined;

  @Input() prevUser?: SharedAuthUIPrevUser = undefined;

  @Output() selectProvider = new EventEmitter<{ method: AuthMethod.password | AuthMethod.phone }>();

  @Output() enterEmail = new EventEmitter<{ email: string }>();

  @Output() signIn = new EventEmitter<{ method: AuthMethod; password?: string; phoneNumber?: string }>();

  @Output() signUp = new EventEmitter<{ method: AuthMethod; password?: string; phoneNumber?: string }>();

  @Output() restorePassword = new EventEmitter<void>();

  @Output() deselectProvider = new EventEmitter<void>();

  @Output() changeUser = new EventEmitter<void>();

  authMethods = AuthMethod;

  authStages = AuthStage;

  userStatuses = UserStatus;

  onProviderClick(provider: AuthMethod): void {
    switch (provider) {
      case AuthMethod.google:
      case AuthMethod.github:
      case AuthMethod.link:
        return this.signIn.emit({ method: provider });
      case AuthMethod.password:
      case AuthMethod.phone:
        return this.selectProvider.emit({ method: provider });
      default:
        throw new Error('Not implemented');
    }
  }
}
