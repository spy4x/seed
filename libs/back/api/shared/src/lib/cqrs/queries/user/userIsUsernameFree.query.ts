import { ApiProperty } from '@nestjs/swagger';

export class UserIsUsernameFreeQuery {
  @ApiProperty()
  userName: string;

  constructor(userName: string) {
    this.userName = userName;
  }
}
