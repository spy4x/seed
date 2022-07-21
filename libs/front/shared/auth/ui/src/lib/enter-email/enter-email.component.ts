import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
} from '@angular/core';
import { AuthStage } from '@seed/front/shared/types';
import { AbstractControl, UntypedFormControl, UntypedFormGroup, ValidationErrors, ValidatorFn } from '@angular/forms';
import isEmail from 'validator/es/lib/isEmail';

@Component({
  selector: 'shared-auth-ui-enter-email',
  templateUrl: './enter-email.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EnterEmailComponent implements OnChanges {
  @Input() email?: string = undefined;

  @Input() inProgress = false;

  @Input() isActiveStage = true;

  @Output() enterEmail = new EventEmitter<{ email: string }>();

  authStages = AuthStage;

  form = new UntypedFormGroup({
    email: new UntypedFormControl(this.email, [this.validateEmail()]),
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (Object.keys(changes).includes('email') && !!this.email) {
      this.form.patchValue({ email: this.email });
    }
  }

  submit(): void {
    if (this.form.invalid) {
      return;
    }
    const { email } = this.form.value as { email: string };
    this.enterEmail.emit({ email });
  }

  validateEmail(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const valid = (control.value as string) && isEmail(control.value as string);
      return valid ? null : { email: true };
    };
  }
}
