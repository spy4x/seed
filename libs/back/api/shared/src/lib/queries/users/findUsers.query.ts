import { IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { PaginationRequestBaseDto } from '../../dto';
import { PAGINATION_DEFAULTS } from '@seed/shared/constants';

export class FindUsersQuery extends PaginationRequestBaseDto {
  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @Type(() => String)
  public search?: string;

  public currentUserId?: string;

  constructor(page = PAGINATION_DEFAULTS.page, limit = PAGINATION_DEFAULTS.limit) {
    super(page, limit);

    this.page = page;
    this.limit = limit;
  }
}
