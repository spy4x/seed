import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Store } from '@ngrx/store';
import { AuthUIActions } from '@seed/front/shared/auth/state';

@Component({
  selector: 'seed-admin-panel-auth-create-profile',
  templateUrl: './create-profile.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateProfileComponent {
  constructor(readonly store: Store) {}

  signOut(): void {
    this.store.dispatch(AuthUIActions.signOut());
  }
}
