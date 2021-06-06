import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class UserDeviceUpdateCommand {
  @ApiProperty({ type: String, required: false })
  @IsString()
  @IsOptional()
  public deviceId?: string;

  @ApiProperty({ type: String, required: false })
  @IsString()
  @IsOptional()
  public deviceName?: string;

  constructor(public id: string, public currentUserId: string, deviceId?: string, deviceName?: string) {
    this.deviceId = deviceId;
    this.deviceName = deviceName;
  }
}
