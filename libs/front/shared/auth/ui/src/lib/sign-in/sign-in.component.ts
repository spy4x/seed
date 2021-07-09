import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, ViewEncapsulation } from '@angular/core';
import { AuthMethods } from '@seed/front/shared/types';

@Component({
  selector: 'seed-shared-auth-ui-sign-in',
  templateUrl: './sign-in.component.html',
  styleUrls: ['./sign-in.component.sass'],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignInUIComponent {
  @Input() isAuthenticated?: null | boolean;

  @Input() isAuthenticating?: null | boolean;

  @Input() errorMessage?: null | string;

  @Input() successMessage?: null | string;

  @Output() signIn = new EventEmitter<{ method: AuthMethods; email?: string; password?: string }>();

  @Output() signUp = new EventEmitter<{ email: string; password: string }>();

  @Output() signOut = new EventEmitter();

  @Output() restorePassword = new EventEmitter<{ email: string }>();

  authMethods = AuthMethods;
}
