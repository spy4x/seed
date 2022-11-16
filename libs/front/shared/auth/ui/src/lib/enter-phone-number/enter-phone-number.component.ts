import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { AbstractControl, FormControl, FormGroup, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import isMobilePhone from 'validator/es/lib/isMobilePhone';

@Component({
  selector: 'shared-auth-ui-enter-phone-number',
  templateUrl: './enter-phone-number.component.html',
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
export class EnterPhoneNumberComponent {
  @Input() inProgress = false;

  @Output() enterPhoneNumber = new EventEmitter<{ phoneNumber: string }>();

  placeholder = '+1234567890';

  form = new FormGroup({
    /* eslint-disable-next-line @typescript-eslint/unbound-method */
    phoneNumber: new FormControl<string>('', [Validators.required, this.validatePhoneNumber()]),
  });

  validationMessages = {
    phoneNumber: `Phone number is not valid`,
  };

  submit(): void {
    if (this.form.invalid) {
      return;
    }
    const { phoneNumber } = this.form.value as { phoneNumber: string };
    this.enterPhoneNumber.emit({ phoneNumber });
  }

  validatePhoneNumber(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const valid =
        (control.value as string) && isMobilePhone(control.value as string, undefined, { strictMode: true });
      return valid ? null : { phoneNumber: true };
    };
  }
}
