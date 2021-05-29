import { ChangeDetectionStrategy, Component, ViewEncapsulation } from '@angular/core';
import { AngularFireAuth } from '@angular/fire/auth';

@Component({
  selector: 'seed-client-core-get-jwt',
  templateUrl: './get-jwt.component.html',
  styleUrls: ['./get-jwt.component.sass'],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GetJwtComponent {
  user$ = this.auth.user;
  token$ = this.auth.idToken;

  constructor(private readonly auth: AngularFireAuth) {}

  signIn(): void {
    void this.auth.signInAnonymously();
  }

  signOut(): void {
    void this.auth.signOut();
  }
}
