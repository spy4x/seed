import { PaginationRequestDTO } from '../../../dtos';

export class UserDevicesFindMyQuery extends PaginationRequestDTO {
  constructor(public currentUserId: string, page?: number, limit?: number) {
    super(page, limit);
  }
}
