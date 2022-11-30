import { UserDevice } from '@prisma/client';

export class UserDeviceUpdatedEvent {
  constructor(public userDevice: UserDevice) {}
}
