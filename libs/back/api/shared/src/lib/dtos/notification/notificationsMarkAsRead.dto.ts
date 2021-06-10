import { ApiProperty } from '@nestjs/swagger';

export class NotificationsMarkAsReadDTO {
  @ApiProperty()
  count: number;

  constructor(count: number) {
    this.count = count;
  }
}
