import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { AuthMethod } from '@seed/front/shared/types';

@Component({
  selector: 'seed-shared-auth-ui-providers-list',
  templateUrl: './providers-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProvidersListComponent {
  @Input() providers: AuthMethod[] = [];

  @Input() inProgress: boolean = false;

  @Input() selectedProvider?: AuthMethod = undefined;

  @Output() select = new EventEmitter<AuthMethod>();

  authMethods = AuthMethod;

  isVisible(provider: AuthMethod): boolean {
    return this.providers.includes(provider);
  }

  isDisabled(): boolean {
    return this.inProgress && !!this.selectedProvider;
  }

  isLoading(provider: AuthMethod): boolean {
    return this.inProgress && this.selectedProvider === provider;
  }
}
