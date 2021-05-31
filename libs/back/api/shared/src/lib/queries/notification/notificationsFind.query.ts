import { PaginationRequestDTO } from '../../dtos';

export class NotificationsFindQuery extends PaginationRequestDTO {
  userId: string;

  constructor(userId: string) {
    super();
    this.userId = userId;
  }
}
