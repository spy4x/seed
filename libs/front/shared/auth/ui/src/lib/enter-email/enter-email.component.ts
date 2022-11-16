import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';

@Component({
  selector: 'shared-auth-ui-enter-email',
  templateUrl: './enter-email.component.html',
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
export class EnterEmailComponent {
  @Input() inProgress = false;

  @Input() isActiveStage = true;

  @Output() email = new EventEmitter<string>();

  form = new FormGroup({
    /* eslint-disable-next-line @typescript-eslint/unbound-method */
    email: new FormControl<string>('', [Validators.required, Validators.email]),
  });

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.email.emit(this.form.value.email as string);
  }
}
