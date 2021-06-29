import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, ViewEncapsulation } from '@angular/core';
import { AuthMethods } from '@seed/front/shared/types';

@Component({
  selector: 'seed-shared-ui-auth-sign-in',
  templateUrl: './sign-in.component.html',
  styleUrls: ['./sign-in.component.sass'],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignInComponent {
  @Input() isIsAuthenticated?: null | boolean;

  @Input() isIsAuthenticating?: null | boolean;

  @Output() signIn = new EventEmitter<AuthMethods>();

  @Output() signOut = new EventEmitter();

  authMethods = AuthMethods;
}
