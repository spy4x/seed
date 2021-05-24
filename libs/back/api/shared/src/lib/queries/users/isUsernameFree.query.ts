import { ApiProperty } from '@nestjs/swagger';

export class IsUsernameFreeQuery {
  @ApiProperty()
  userName: string;

  constructor(userName: string) {
    this.userName = userName;
  }
}
