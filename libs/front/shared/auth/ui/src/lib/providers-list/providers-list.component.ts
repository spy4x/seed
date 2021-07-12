import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { AuthMethod } from '@seed/front/shared/types';

@Component({
  selector: 'seed-shared-auth-ui-providers-list',
  templateUrl: './providers-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProvidersListComponent {
  @Input() providers: AuthMethod[] = [];

  @Input() selectedProvider?: AuthMethod = undefined;

  @Output() select = new EventEmitter<AuthMethod>();

  authMethods = AuthMethod;
}
