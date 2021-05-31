import { IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { PaginationRequestDTO } from '../../dtos';
import { PAGINATION_DEFAULTS } from '@seed/shared/constants';

export class UsersFindQuery extends PaginationRequestDTO {
  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @Type(() => String)
  public search?: string;

  public currentUserId?: string;

  constructor(page = PAGINATION_DEFAULTS.page, limit = PAGINATION_DEFAULTS.limit, search?: string) {
    super(page, limit);
    this.search = search;
  }
}
