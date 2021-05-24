import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class GetCurrentUserQuery {
  @ApiProperty({ required: true })
  @IsString()
  id: string;

  constructor(id: string) {
    this.id = id;
  }
}
