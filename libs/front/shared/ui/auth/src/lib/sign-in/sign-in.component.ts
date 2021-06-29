import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, ViewEncapsulation } from '@angular/core';
import { User } from '@prisma/client';

export enum SignInMethods {
  anonymous = 'anonymous',
}

@Component({
  selector: 'seed-shared-ui-auth-sign-in',
  templateUrl: './sign-in.component.html',
  styleUrls: ['./sign-in.component.sass'],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignInComponent {
  @Input() user?: User;

  @Input() jwt?: string;

  @Input() fcm?: string;

  @Output() signIn = new EventEmitter<SignInMethods>();

  @Output() signOut = new EventEmitter();

  copyStatus = {
    userId: false,
    jwt: false,
    fcm: false,
  };

  SignInMethods = SignInMethods;
}
