import { ChangeDetectionStrategy, Component, ViewEncapsulation } from '@angular/core';
import { AngularFireAuth } from '@angular/fire/auth';
import { catchError, switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { AngularFireMessaging } from '@angular/fire/messaging';

export enum SignInMethods {
  anonymous = 'anonymous',
}

@Component({
  selector: 'seed-auth-sign-in',
  templateUrl: './sign-in.component.html',
  styleUrls: ['./sign-in.component.sass'],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignInComponent {
  SignInMethods = SignInMethods;

  copyStatus = {
    userId: false,
    jwt: false,
    fcm: false,
  };

  user$ = this.auth.user;

  jwt$ = this.auth.idToken;

  fcm$ = this.jwt$.pipe(
    switchMap(() =>
      this.messaging.requestToken.pipe(
        catchError(() => of(null)), // User rejected notifications API request or it's not supported by browser
      ),
    ),
  );

  constructor(private readonly auth: AngularFireAuth, private readonly messaging: AngularFireMessaging) {}

  signIn(method: SignInMethods): void {
    switch (method) {
      case SignInMethods.anonymous:
        void this.auth.signInAnonymously();
        break;
      default:
        break;
    }
  }

  signOut(): void {
    void this.auth.signOut();
  }
}
