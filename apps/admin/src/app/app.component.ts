import { ChangeDetectionStrategy, Component } from '@angular/core';
import { createUser, User } from '@afs/types';

/**
 * Root component of the application
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'afs-root',
  styleUrls: ['./app.component.sass'],
  templateUrl: './app.component.pug'
})
export class AppComponent {
  /**
   * Title is displayed in template as a static text
   */
  title = 'admin';
  /**
   * Currently authenticated user
   */
  user: User = createUser({
    email: 'admin@email.com',
    name: 'Admin',
    photoUrl:
      'https://i0.wp.com/www.winhelponline.com/blog/wp-content/uploads/2017/12/user.png?fit=256%2C256&quality=100&ssl=1'
  });
}
