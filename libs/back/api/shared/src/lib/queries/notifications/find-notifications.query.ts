import { PaginationRequestBaseDto } from '../../dto';

export class FindNotificationsQuery extends PaginationRequestBaseDto {
  userId: string;

  constructor(userId: string) {
    super();
    this.userId = userId;
  }
}
