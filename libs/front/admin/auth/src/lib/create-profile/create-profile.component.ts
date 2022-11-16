import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Store } from '@ngrx/store';
import { AuthSelectors, AuthUIActions } from '@seed/front/shared/auth/state';
import { map } from 'rxjs';
import { User } from '@prisma/client';

@Component({
  selector: 'admin-auth-create-profile',
  templateUrl: './create-profile.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateProfileComponent {
  user$ = this.store.select(AuthSelectors.getUser).pipe(map(u => u as User));

  constructor(readonly store: Store) {}

  signOut(): void {
    this.store.dispatch(AuthUIActions.signOut());
  }
}
