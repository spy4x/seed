import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class GetUserQuery {
  @ApiProperty({ required: true })
  @IsString()
  id: string;

  /**
   * @param currentUserId used to check if searched user is following currentUser
   */
  @ApiProperty({ required: false })
  currentUserId!: string;

  constructor(id: string) {
    this.id = id;
  }
}
