import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { Store } from '@ngrx/store';
import { AuthSelectors, AuthUIActions } from '@seed/front/shared/auth/state';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { BehaviorSubject, filter, take } from 'rxjs';
import { ONE, USER_EMAIL_RULES, USER_NAME_RULES, ZERO } from '@seed/shared/constants';
import { AuthStage } from '@seed/front/shared/types';

@Component({
  selector: 'web-auth-create-profile',
  templateUrl: './create-profile.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateProfileComponent implements OnInit {
  data = 'Initial value';

  photoURL$ = new BehaviorSubject<null | undefined | string>(null);

  /* eslint-disable @typescript-eslint/unbound-method */
  form = new FormGroup({
    firstName: new FormControl<string>('', [Validators.required, Validators.maxLength(USER_NAME_RULES.maxLength)]),
    lastName: new FormControl<string>('', [Validators.required, Validators.maxLength(USER_NAME_RULES.maxLength)]),
    email: new FormControl<string>('', [
      Validators.required,
      Validators.email,
      Validators.maxLength(USER_EMAIL_RULES.maxLength),
    ]),
  });
  /* eslint-enable @typescript-eslint/unbound-method */

  constructor(readonly store: Store) {}

  ngOnInit(): void {
    this.store
      .select(AuthSelectors.getAuthState)
      .pipe(
        filter(state => state.stage === AuthStage.creatingProfile),
        take(ONE),
      )
      .subscribe(authState => {
        this.photoURL$.next(authState.photoURL);
        this.form.setValue({
          firstName: authState.displayName?.split(' ')[ZERO] ?? '',
          lastName: authState.displayName?.split(' ')[ONE] ?? '',
          email: authState.email ?? '',
        });
        this.form.markAsUntouched();
      });
  }

  createProfile(): void {
    if (!this.form.valid) {
      this.form.markAllAsTouched();
      return;
    }
    const firstName = this.form.controls.firstName.value || '';
    const lastName = this.form.controls.lastName.value || '';
    const email = this.form.controls.email.value || '';
    this.store.dispatch(
      AuthUIActions.profileCreate({ user: { firstName, lastName, email, photoURL: this.photoURL$.value } }),
    );
  }

  signOut(): void {
    this.store.dispatch(AuthUIActions.signOut());
  }
}
