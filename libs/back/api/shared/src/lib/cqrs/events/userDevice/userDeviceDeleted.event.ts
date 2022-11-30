import { UserDevice } from '@prisma/client';

export class UserDeviceDeletedEvent {
  constructor(public userDevice: UserDevice) {}
}
