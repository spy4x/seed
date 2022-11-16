import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'shared-auth-ui-display-user',
  templateUrl: './display-user.component.html',
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
export class DisplayUserComponent {
  @Input() userId?: string = undefined;

  @Input() email?: string = undefined;

  @Input() displayName?: string = undefined;

  @Input() photoURL?: string = undefined;

  @Output() changeUser = new EventEmitter<void>();

  @Output() signOut = new EventEmitter<void>();
}
