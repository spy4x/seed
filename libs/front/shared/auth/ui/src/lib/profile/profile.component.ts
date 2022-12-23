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
  selector: 'shared-auth-ui-profile[user]',
  templateUrl: './profile.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileComponent implements OnChanges {
  @Input() user!: User;

  @Input() isSaving = false;

  @Output() signOut = new EventEmitter<void>();

  @Output() update = new EventEmitter<Partial<User>>();

  /* eslint-disable @typescript-eslint/unbound-method */
  form = new FormGroup({
    firstName: new FormControl<string>('', [Validators.required, Validators.maxLength(USER_NAME_RULES.maxLength)]),
    lastName: new FormControl<string>('', [Validators.required, Validators.maxLength(USER_NAME_RULES.maxLength)]),
    photoURL: new FormControl<string>('', []),
  });
  /* eslint-enable @typescript-eslint/unbound-method */

  ngOnChanges(changes: SimpleChanges): void {
    if ('user' in changes && changes['user'].currentValue !== changes['user'].previousValue) {
      this.form.patchValue(this.user);
    }
  }

  updateProfile(): void {
    if (!this.form.valid) {
      this.form.markAllAsTouched();
      return;
    }
    const firstName = this.form.controls.firstName.value || '';
    const lastName = this.form.controls.lastName.value || '';
    const photoURL = this.form.controls.photoURL.value || '';
    this.update.emit({ firstName, lastName, photoURL });
  }
}
