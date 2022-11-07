import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Store } from '@ngrx/store';
import { AuthUIActions } from '@seed/front/shared/auth/state';

@Component({
  selector: 'admin-profile',
  templateUrl: './profile.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileComponent {
  constructor(readonly store: Store) {}

  signOut(): void {
    this.store.dispatch(AuthUIActions.signOut());
  }
}
