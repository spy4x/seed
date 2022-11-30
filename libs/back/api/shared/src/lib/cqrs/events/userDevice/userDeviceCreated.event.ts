import { UserDevice } from '@prisma/client';

export class UserDeviceCreatedEvent {
  constructor(public userDevice: UserDevice) {}
}
