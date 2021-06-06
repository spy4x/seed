import { ApiProperty } from '@nestjs/swagger';
import { UserDevice } from '@prisma/client';

export class UserDeviceDTO implements UserDevice {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  fcmToken: string;

  @ApiProperty({ required: false, type: String })
  deviceId: string | null;

  @ApiProperty({ required: false, type: String })
  deviceName: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  constructor(
    id: string,
    userId: string,
    fcmToken: string,
    deviceId: string,
    deviceName: string,
    createdAt: Date,
    updatedAt: Date,
  ) {
    this.id = id;
    this.userId = userId;
    this.fcmToken = fcmToken;
    this.deviceId = deviceId;
    this.deviceName = deviceName;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }
}
