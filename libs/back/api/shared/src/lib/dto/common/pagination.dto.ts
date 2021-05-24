import { ApiProperty } from '@nestjs/swagger';

export class Pagination<T> {
  @ApiProperty()
  public data: T[];

  @ApiProperty()
  public page: number;

  @ApiProperty()
  public limit: number;

  @ApiProperty()
  public total: number;

  constructor(data: T[], page: number, limit: number, total: number) {
    this.data = data;
    this.page = page;
    this.limit = limit;
    this.total = total;
  }
}
