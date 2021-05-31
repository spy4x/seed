import { ApiProperty } from '@nestjs/swagger';

export class UserIsUsernameFreeDTO {
  @ApiProperty()
  isFree: boolean;

  constructor(isFree: boolean) {
    this.isFree = isFree;
  }
}
