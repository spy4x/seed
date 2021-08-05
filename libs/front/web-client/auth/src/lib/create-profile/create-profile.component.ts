import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Store } from '@ngrx/store';
import { AuthUIActions } from '@seed/front/shared/auth/state';

@Component({
  selector: 'seed-web-client-auth-create-profile',
  templateUrl: './create-profile.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateProfileComponent {
  constructor(readonly store: Store) {}

  createProfile(): void {
    const random = Math.random().toString();
    this.store.dispatch(
      AuthUIActions.profileCreate({
        user: {
          id: random,
          userName: random,
          firstName: random,
          lastName: random,
        },
      }),
    );
  }

  signOut(): void {
    this.store.dispatch(AuthUIActions.signOut());
  }
}
