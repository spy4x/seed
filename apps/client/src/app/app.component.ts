import { Component } from '@angular/core';
import { User } from '@afs/types';

@Component({
  selector: 'afs-root',
  templateUrl: './app.component.pug',
  styleUrls: ['./app.component.sass']
})
export class AppComponent {
  title = 'client';
  user: User = {
    id: '2',
    name: 'User',
    email: 'user@email.com',
    photoUrl: 'https://atlassian.design/server/images/avatars/project-128.png'
  };
}
