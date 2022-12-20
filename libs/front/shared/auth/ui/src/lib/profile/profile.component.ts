import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
} from '@angular/core';
import { User } from '@prisma/client';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { USER_NAME_RULES } from '@seed/shared/constants';

@Component({
  selector: 'shared-auth-ui-profile',
  templateUrl: './profile.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }
    `,
  ],
})
export class ProfileComponent implements OnChanges {
  ngOnChanges(changes: SimpleChanges): void {
    console.log(this.user);
    if (changes['user'].previousValue !== changes['user'].currentValue && this.user !== undefined) {
      this.form.patchValue(this.user);
    }
  }
  @Input() user?: User;

  @Output() signOut = new EventEmitter<void>();

  /* eslint-disable @typescript-eslint/unbound-method */
  form = new FormGroup({
    firstName: new FormControl<string>('', [Validators.required, Validators.maxLength(USER_NAME_RULES.maxLength)]),
    lastName: new FormControl<string>('', [Validators.required, Validators.maxLength(USER_NAME_RULES.maxLength)]),
    photoURL: new FormControl<string>('', []),
  });
  /* eslint-enable @typescript-eslint/unbound-method */

  createProfile(): void {
    if (!this.form.valid) {
      this.form.markAllAsTouched();
      return;
    }
    const firstName = this.form.controls.firstName.value || '';
    const lastName = this.form.controls.lastName.value || '';
    const photoURL = this.form.controls.photoURL.value || '';
    /* eslint-disable-next-line */
    console.log(firstName, lastName, photoURL);
    // this.store.dispatch(
    //   AuthUIActions.profileCreate({ user: { firstName, lastName, email, photoURL: this.photoURL$.value } }),
    // );
  }
}
