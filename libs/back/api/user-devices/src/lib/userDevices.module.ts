import { Module } from '@nestjs/common';

import { UserDevicesController } from './userDevices.controller';
import { UserDevicesFindMyQueryHandler } from './queryHandlers';
import {
  UserDeviceCreateCommandHandler,
  UserDeviceDeleteCommandHandler,
  UserDeviceUpdateCommandHandler,
} from './commandHandlers';

const queryHandlers = [UserDevicesFindMyQueryHandler];
const commandHandlers = [
  UserDeviceCreateCommandHandler,
  UserDeviceUpdateCommandHandler,
  UserDeviceDeleteCommandHandler,
];

@Module({
  controllers: [UserDevicesController],
  providers: [...queryHandlers, ...commandHandlers],
})
export class UserDevicesModule {}
