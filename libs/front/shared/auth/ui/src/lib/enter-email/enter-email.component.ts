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
import { AbstractControl, FormControl, FormGroup, ValidationErrors, ValidatorFn } from '@angular/forms';
import isEmail from 'validator/es/lib/isEmail';

@Component({
  selector: 'seed-shared-auth-ui-enter-email',
  templateUrl: './enter-email.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EnterEmailComponent implements OnChanges {
  @Input() email?: string = undefined;

  @Input() inProgress = false;

  @Input() isActiveStage = true;

  @Output() enterEmail = new EventEmitter<{ email: string }>();

  authStages = AuthStage;

  form = new FormGroup({
    email: new FormControl(this.email, [this.validateEmail()]),
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.email && this.email) {
      this.form.patchValue({ email: this.email });
    }
  }

  submit(): void {
    if (this.form.invalid) {
      return;
    }
    this.enterEmail.emit({ email: this.form.value.email });
  }

  validateEmail(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const valid = control.value && isEmail(control.value);
      return valid ? null : { email: true };
    };
  }
}
