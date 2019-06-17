import { Component } from '@angular/core';
import { User } from '@afs/types';

@Component({
  selector: 'afs-root',
  templateUrl: './app.component.pug',
  styleUrls: ['./app.component.sass']
})
export class AppComponent {
  title = 'admin';
  user: User = {
    id: '1',
    name: 'Admin',
    email: 'admin@email.com',
    photoUrl:
      'https://i0.wp.com/www.winhelponline.com/blog/wp-content/uploads/2017/12/user.png?fit=256%2C256&quality=100&ssl=1'
  };
}
