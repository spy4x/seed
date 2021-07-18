import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { AuthProvider } from '@seed/front/shared/types';

@Component({
  selector: 'seed-shared-auth-ui-providers-list',
  templateUrl: './providers-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProvidersListComponent {
  @Input() providers: AuthProvider[] = [];

  @Input() inProgress = false;

  @Input() selectedProvider?: AuthProvider = undefined;

  @Output() selectProvider = new EventEmitter<AuthProvider>();

  authProviders = AuthProvider;

  isVisible(provider: AuthProvider): boolean {
    return this.providers.includes(provider);
  }

  isDisabled(): boolean {
    return this.inProgress && !!this.selectedProvider;
  }

  isLoading(provider: AuthProvider): boolean {
    return this.inProgress && this.selectedProvider === provider;
  }
}
