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
  @Input() id = '';

  @Input() label = '';

  /**
   * https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/autocomplete
   */
  @Input() autocomplete?:
    | 'off'
    | 'on'
    | 'name'
    | 'honorific-prefix'
    | 'given-name'
    | 'additional-name'
    | 'family-name'
    | 'honorific-suffix'
    | 'email'
    | 'nickname'
    | 'username'
    | 'new-password'
    | 'current-password'
    | 'one-time-code'
    | 'organization-title'
    | 'organization'
    | 'street-address'
    | 'address-line1'
    | 'address-line2'
    | 'address-line3'
    | 'address-level4'
    | 'address-level3'
    | 'address-level2'
    | 'address-level1'
    | 'country'
    | 'country-name'
    | 'postal-code'
    | 'cc-name'
    | 'cc-given-name'
    | 'cc-additional-name'
    | 'cc-family-name'
    | 'cc-number'
    | 'cc-exp'
    | 'cc-exp-month'
    | 'cc-exp-year'
    | 'cc-csc'
    | 'cc-type'
    | 'transaction-currency'
    | 'transaction-amount'
    | 'language'
    | 'bday'
    | 'bday-day'
    | 'bday-month'
    | 'bday-year'
    | 'sex'
    | 'tel'
    | 'tel-country-code'
    | 'tel-national'
    | 'tel-area-code'
    | 'tel-local'
    | 'tel-extension'
    | 'impp'
    | 'url'
    | 'photo';

  @Input() inputType = 'text';

  @Input() e2e = '';

  @Input() autofocus = false;

  @Input() readonly = false;

  @Input() placeholder = '';

  @Input() validationMessages: {
    [validationKey: string]: string;
  } = {};

  _isDisabled = false;

  _isRequired = false;

  constructor(private readonly formControl: NgControl) {
    formControl.valueAccessor = this;
  }

  _value: null | unknown = null;

  get value(): ValueType {
    return this._value;
  }

  set value(value: ValueType) {
    this._value = value;
    this.onChange(value);
    this.onTouch(value);
  }

  ngOnInit(): void {
    if (!this.id && this.formControl.name) {
      this.id = `${this.formControl.name.toString()}_${Math.random()}`;
    }
    /* eslint-disable @typescript-eslint/unbound-method */
    this._isRequired = this.formControl.control?.hasValidator(Validators.required) ?? false;
    /* eslint-enable @typescript-eslint/unbound-method */
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
    for (const key of Object.keys(errors)) {
      if (this.validationMessages[key]) {
        return this.validationMessages[key];
      }
      if (key === 'required') {
        return `Required`;
      }
      if (key === 'minlength') {
        const { requiredLength } = errors[key] as LengthValidationError;
        return `Min ${requiredLength} characters long`;
      }
      if (key === 'maxlength') {
        const { requiredLength } = errors[key] as LengthValidationError;
        return `Max ${requiredLength} characters long`;
      }
      if (key === 'email') {
        return `Invalid email`;
      }
    }
    return 'Validation error';
  }
}
