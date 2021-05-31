import { IsInt, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { PAGINATION_DEFAULTS } from '@seed/shared/constants';

export class PaginationRequestDTO {
  @ApiProperty({ type: Number, required: false })
  @IsOptional()
  @Min(PAGINATION_DEFAULTS.page, {
    message: `Page should be greater or equal to ${PAGINATION_DEFAULTS.page}`,
  })
  @IsInt()
  @Type(() => Number)
  public page: number;

  @ApiProperty({ type: Number, required: false })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  public limit: number;

  constructor(page = PAGINATION_DEFAULTS.page, limit = PAGINATION_DEFAULTS.limit) {
    this.page = page;
    this.limit = limit;
  }
}
