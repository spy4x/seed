import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

export const DisplayUserComponent_PHOTO_URL_PLACEHOLDER =
  'https://i.pinimg.com/originals/0c/3b/3a/0c3b3adb1a7530892e55ef36d3be6cb8.png';

@Component({
  selector: 'shared-auth-ui-display-user',
  templateUrl: './display-user.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DisplayUserComponent {
  @Input() userId?: string = undefined;

  @Input() email?: string = undefined;

  @Input() displayName?: string = undefined;

  @Input() photoURL?: string = undefined;

  @Output() changeUser = new EventEmitter<void>();

  @Output() signOut = new EventEmitter<void>();

  photoURLPlaceholder = DisplayUserComponent_PHOTO_URL_PLACEHOLDER;
}
