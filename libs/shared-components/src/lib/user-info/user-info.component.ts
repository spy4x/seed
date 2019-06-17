import {
  ChangeDetectionStrategy,
  Component,
  Input,
  ViewEncapsulation
} from '@angular/core';
import { User } from '@afs/types';

@Component({
  selector: 'afs-user-info',
  templateUrl: './user-info.component.pug',
  styleUrls: ['./user-info.component.sass'],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UserInfoComponent {
  @Input() user: User;
}
