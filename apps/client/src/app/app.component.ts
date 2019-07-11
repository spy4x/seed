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
  title = 'client';
  /**
   * Currently authenticated user
   */
  user: User = createUser({
    email: 'user@email.com',
    id: '2',
    name: 'User',
    photoUrl: 'https://atlassian.design/server/images/avatars/project-128.png'
  });
}
