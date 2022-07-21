import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';

const minLength = 10;

@Component({
  selector: 'shared-auth-ui-enter-password',
  templateUrl: './enter-password.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EnterPasswordComponent {
  @Input() inProgress = false;

  @Input() isActiveStage = true;

  @Output() enterPassword = new EventEmitter<{ password: string }>();

  form = new FormGroup({
    /* eslint-disable-next-line @typescript-eslint/unbound-method */
    password: new FormControl('', [Validators.required, Validators.minLength(minLength)]),
  });

  submit(): void {
    if (this.form.invalid) {
      return;
    }
    const { password } = this.form.value as { password: string };
    this.enterPassword.emit({ password });
  }
}
