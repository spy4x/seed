import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { User } from '@prisma/client';

@Component({
  selector: 'shared-auth-ui-profile',
  templateUrl: './profile.component.html',
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
export class ProfileComponent {
  @Input() user?: User;

  @Output() signOut = new EventEmitter<void>();
}
