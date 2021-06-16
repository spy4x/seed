import { ChangeDetectionStrategy, Component, ViewEncapsulation } from '@angular/core';
import { AngularFireAuth } from '@angular/fire/auth';
import { AngularFireMessaging } from '@angular/fire/messaging';
import { catchError, switchMap } from 'rxjs/operators';
import { of } from 'rxjs';

@Component({
  selector: 'seed-web-client-core-get-jwt',
  templateUrl: './get-jwt.component.html',
  styleUrls: ['./get-jwt.component.sass'],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GetJwtComponent {
  user$ = this.auth.user;

  jwtToken$ = this.auth.idToken;

  fcmToken$ = this.jwtToken$.pipe(
    switchMap(() =>
      this.messaging.requestToken.pipe(
        catchError(() => of(null)), // User rejected notifications API request or it's not supported by browser
      ),
    ),
  );

  constructor(readonly auth: AngularFireAuth, readonly messaging: AngularFireMessaging) {}

  signIn(): void {
    void this.auth.signInAnonymously();
  }

  signOut(): void {
    void this.auth.signOut();
  }
}
