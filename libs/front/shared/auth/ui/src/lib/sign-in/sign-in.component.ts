import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
} from '@angular/core';
import { AuthProvider, AuthStage } from '@seed/front/shared/types';
import { difference } from 'lodash-es';

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
export class SignInUIComponent implements OnChanges {
  @Input() stage = AuthStage.initialization;

  @Input() inProgress = false;

  @Input() userId?: string = undefined;

  @Input() email?: string = undefined;

  @Input() displayName?: string = undefined;

  @Input() photoURL?: string = undefined;

  @Input() errorMessage?: string = undefined;

  @Input() successMessage?: string = undefined;

  @Input() providers: AuthProvider[] = [];

  @Input() selectedProvider?: AuthProvider = undefined;

  @Input() isNewUser: boolean = false;

  @Output() selectProvider = new EventEmitter<{ provider: AuthProvider }>();

  @Output() enterEmail = new EventEmitter<{ email: string }>();

  @Output() sign = new EventEmitter<{ provider: AuthProvider; password?: string; phoneNumber?: string }>();

  @Output() restorePassword = new EventEmitter<void>();

  @Output() deselectProvider = new EventEmitter<void>();

  @Output() changeUser = new EventEmitter<void>();

  @Output() signOut = new EventEmitter<void>();

  authProviders = AuthProvider;

  authStages = AuthStage;

  allProviders = (Object.keys(AuthProvider) as AuthProvider[]).filter(p => p !== AuthProvider.anonymous);

  alternativeProviders: AuthProvider[] = [];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.providers) {
      const providersThatCantBeEasilyLinked = [AuthProvider.phone, AuthProvider.github];
      this.alternativeProviders = difference(this.allProviders, [
        ...this.providers,
        ...providersThatCantBeEasilyLinked,
      ]);
    }
  }

  onProviderClick(provider: AuthProvider): void {
    switch (provider) {
      case AuthProvider.google:
      case AuthProvider.github:
      case AuthProvider.link:
        return this.sign.emit({ provider: provider });
      case AuthProvider.password:
      case AuthProvider.phone:
        return this.selectProvider.emit({ provider: provider });
      default:
        throw new Error('Not implemented');
    }
  }

  enterPassword(password: string): void {
    this.sign.emit({ provider: AuthProvider.password, password });
  }
}
