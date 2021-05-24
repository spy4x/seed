import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class AddUserDeviceDto {
  @ApiProperty()
  public fcmToken: string;

  @ApiProperty()
  @IsString()
  @IsOptional()
  public deviceId: string | null;

  @ApiProperty()
  @IsOptional()
  public deviceName: string | null;

  constructor(fcmToken: string, deviceId: string | null, deviceName: string | null) {
    this.fcmToken = fcmToken;
    this.deviceId = deviceId;
    this.deviceName = deviceName;
  }
}
