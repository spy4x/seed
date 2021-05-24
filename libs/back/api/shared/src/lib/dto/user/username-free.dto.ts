import { ApiProperty } from '@nestjs/swagger';

export class UsernameFreeDto {
  @ApiProperty()
  isFree: boolean;

  constructor(isFree: boolean) {
    this.isFree = isFree;
  }
}
