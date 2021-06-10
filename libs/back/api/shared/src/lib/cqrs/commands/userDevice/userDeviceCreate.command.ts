import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class UserDeviceCreateCommand {
  @ApiProperty()
  @IsString()
  public fcmToken: string;

  @ApiProperty({ type: String, required: false })
  @IsString()
  @IsOptional()
  public deviceId: string | null;

  @ApiProperty({ type: String, required: false })
  @IsString()
  @IsOptional()
  public deviceName: string | null;

  constructor(public userId: string, fcmToken: string, deviceId?: string, deviceName?: string) {
    this.fcmToken = fcmToken;
    this.deviceId = deviceId || null;
    this.deviceName = deviceName || null;
  }
}
