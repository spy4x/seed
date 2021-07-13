import { ChangeDetectionStrategy, Component, Input, Output, EventEmitter } from '@angular/core';

@Component({
  selector: 'seed-shared-auth-ui-display-prev-user',
  templateUrl: './display-prev-user.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DisplayPrevUserComponent {
  @Input() displayName?: string = undefined;

  @Input() email?: string = undefined;

  @Input() phoneNumber?: string = undefined;

  @Input() photoURL?: string = undefined;

  @Output() changeUser = new EventEmitter<void>();
}
