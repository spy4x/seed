import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';

export class NotificationsMarkAsReadCommand {
  @ApiProperty({ type: [String], required: false })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  ids?: string[];

  constructor(public currentUserId: string, ids?: string[]) {
    this.ids = ids;
  }
}
