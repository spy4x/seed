import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';

@Component({
  selector: 'seed-shared-auth-ui-enter-password',
  templateUrl: './enter-password.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EnterPasswordComponent {
  @Input() inProgress = false;

  @Input() isActiveStage = true;

  @Output() enterPassword = new EventEmitter<{ password: string }>();

  form = new FormGroup({
    password: new FormControl('', [Validators.required, Validators.minLength(10)]),
  });

  submit(): void {
    if (this.form.invalid) {
      return;
    }
    this.enterPassword.emit({ password: this.form.value.password });
  }
}
