import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { AbstractControl, FormControl, FormGroup, ValidationErrors, ValidatorFn } from '@angular/forms';
import isMobilePhone from 'validator/es/lib/isMobilePhone';

@Component({
  selector: 'seed-shared-auth-ui-enter-phone-number',
  templateUrl: './enter-phone-number.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EnterPhoneNumberComponent {
  @Input() inProgress = false;

  @Output() enterPhoneNumber = new EventEmitter<{ phoneNumber: string }>();

  placeholder = '+1-234-567-8901';

  form = new FormGroup({
    phoneNumber: new FormControl('', [this.validateEmail()]),
  });

  submit(): void {
    if (this.form.invalid) {
      return;
    }
    this.enterPhoneNumber.emit({ phoneNumber: this.form.value.phoneNumber });
  }

  validateEmail(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const valid = control.value && isMobilePhone(control.value, undefined, { strictMode: true });
      return valid ? null : { phoneNumber: true };
    };
  }
}
