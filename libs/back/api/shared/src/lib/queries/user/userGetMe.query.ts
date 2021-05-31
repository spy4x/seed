import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class UserGetMeQuery {
  @ApiProperty({ required: true })
  @IsString()
  id: string;

  constructor(id: string) {
    this.id = id;
  }
}
