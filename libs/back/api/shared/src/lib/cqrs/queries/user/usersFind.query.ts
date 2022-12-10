import { IsEnum, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { PaginationRequestDTO } from '../../../dtos';
import { PAGINATION_DEFAULTS } from '@seed/shared/constants';
import { UserRole } from '@prisma/client';

export class UsersFindQuery extends PaginationRequestDTO {
  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @Type(() => String)
  public search?: string;

  @ApiProperty({ enum: UserRole, enumName: 'UserRole', required: false })
  @IsOptional()
  @IsEnum(UserRole, {
    message: `Field 'role' should be one of values: [${Object.keys(UserRole).join(', ')}]`,
  })
  public role?: UserRole;

  constructor(page = PAGINATION_DEFAULTS.page, limit = PAGINATION_DEFAULTS.limit, search?: string, role?: UserRole) {
    super(page, limit);
    this.search = search;
    this.role = role;
  }
}
