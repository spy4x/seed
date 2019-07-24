import { ChangeDetectionStrategy, Component, Input, ViewEncapsulation } from '@angular/core';
import { User } from '@afs/types';

/**
 * UI component that displays currently authenticated user
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  selector: 'afs-user-info',
  styleUrls: ['./user-info.component.sass'],
  templateUrl: './user-info.component.pug'
})
export class UserInfoComponent {
  /**
   * Authenticated user. Could be "null"
   */
  @Input() user: User | null = null;
}
