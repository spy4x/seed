import { Component, Input, OnInit, ViewEncapsulation } from '@angular/core';
import { ControlValueAccessor, NgControl, Validators } from '@angular/forms';
import { ZERO } from '@seed/shared/constants';

type ValueType = null | unknown;
type EventHandlerType = (_value: ValueType) => void;
interface LengthValidationError {
  requiredLength: number;
}

@Component({
  selector: 'seed-input',
  templateUrl: './input.component.html',
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
  encapsulation: ViewEncapsulation.None,
})
export class InputComponent implements OnInit, ControlValueAccessor {
  @Input() label = '';

  _isDisabled = false;

  _isRequired = false;

  _value: null | unknown = null;

  constructor(private readonly formControl: NgControl) {
    formControl.valueAccessor = this;
  }

  ngOnInit(): void {
    /* eslint-disable @typescript-eslint/unbound-method */
    this._isRequired = this.formControl.control?.hasValidator(Validators.required) ?? false;
    /* eslint-enable @typescript-eslint/unbound-method */
  }

  get value(): ValueType {
    return this._value;
  }

  set value(value: ValueType) {
    this._value = value;
    this.onChange(value);
    this.onTouch(value);
  }

  onChange: EventHandlerType = (): void => {
    return void ZERO;
  };

  onTouch: EventHandlerType = (): void => {
    return void ZERO;
  };

  registerOnChange(fn: EventHandlerType): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: EventHandlerType): void {
    this.onTouch = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this._isDisabled = isDisabled;
  }

  writeValue(value: ValueType): void {
    this.value = value;
  }

  isInvalid(): boolean {
    return (this.formControl.invalid && this.formControl.touched) || false;
  }

  isValid(): boolean {
    return this.formControl.valid || false;
  }

  getErrorMessage(): string {
    const { errors } = this.formControl;
    if (!errors) {
      return 'Error placeholder';
    }
    if (errors['required']) {
      return 'Required';
    }
    if (errors['minlength']) {
      return `Minimum length is ${(errors['minlength'] as LengthValidationError).requiredLength}`;
    }
    if (errors['maxlength']) {
      return `Maximum length is ${(errors['maxlength'] as LengthValidationError).requiredLength}`;
    }
    if (errors['email']) {
      return `Email is invalid`;
    }
    return 'Validation error';
  }
}
