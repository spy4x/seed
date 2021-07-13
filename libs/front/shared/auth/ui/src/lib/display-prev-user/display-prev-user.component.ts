import { ChangeDetectionStrategy, Component, Input, Output, EventEmitter } from '@angular/core';
import { PreviouslyAuthenticatedUser } from '@seed/front/shared/types';

export const DisplayPrevUserComponent_PHOTO_URL_PLACEHOLDER =
  'https://i.pinimg.com/originals/0c/3b/3a/0c3b3adb1a7530892e55ef36d3be6cb8.png';

@Component({
  selector: 'seed-shared-auth-ui-display-prev-user',
  templateUrl: './display-prev-user.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DisplayPrevUserComponent {
  @Input() user?: PreviouslyAuthenticatedUser = undefined;

  @Output() changeUser = new EventEmitter<void>();

  photoURLPlaceholder = DisplayPrevUserComponent_PHOTO_URL_PLACEHOLDER;
}
