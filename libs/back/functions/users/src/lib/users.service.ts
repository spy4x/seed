import { Injectable } from '@nestjs/common';
import { auth } from 'firebase-admin';

@Injectable()
export class UsersService {
  async log(user: auth.UserRecord): Promise<void> {
    console.log('User was created', user);
  }
}
