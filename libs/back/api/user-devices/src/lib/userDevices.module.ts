import { Module } from '@nestjs/common';

import { UserDevicesController } from './userDevices.controller';
import { UserDevicesFindMyQueryHandler } from './queryHandlers';
import {
  UserDeviceCreateCommandHandler,
  UserDeviceDeleteCommandHandler,
  UserDeviceUpdateCommandHandler,
} from './commandHandlers';
import { NotificationSendPushInvalidTokensEventHandler } from './eventHandlers/notification-send-push-invalid-tokens.event-handlers';

const commandHandlers = [
  UserDeviceCreateCommandHandler,
  UserDeviceUpdateCommandHandler,
  UserDeviceDeleteCommandHandler,
];
const eventHandlers = [NotificationSendPushInvalidTokensEventHandler];
const queryHandlers = [UserDevicesFindMyQueryHandler];

@Module({
  controllers: [UserDevicesController],
  providers: [...commandHandlers, ...eventHandlers, ...queryHandlers],
})
export class UserDevicesModule {}
