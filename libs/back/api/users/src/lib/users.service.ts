import { Injectable } from '@nestjs/common';
import { auth } from 'firebase-admin';
import { LogService } from '@seed/back/api/shared';

@Injectable()
export class UsersService {
  logService = new LogService(UsersService.name);

  async onCreated(user: auth.UserRecord): Promise<void> {
    await this.logService.trackSegment(this.onCreated.name, async logSegment => {
      logSegment.log(`User was created`, user);
      return Promise.resolve();
    });
  }
}
