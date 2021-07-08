import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, ViewEncapsulation } from '@angular/core';
import { AuthMethods } from '@seed/front/shared/types';

@Component({
  selector: 'seed-shared-auth-ui-sign-in',
  templateUrl: './sign-in.component.html',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignInUIComponent {
  @Input() isAuthenticated?: null | boolean;

  @Input() isAuthenticating?: null | boolean;

  @Output() signIn = new EventEmitter<AuthMethods>();

  @Output() signOut = new EventEmitter();

  authMethods = AuthMethods;
}