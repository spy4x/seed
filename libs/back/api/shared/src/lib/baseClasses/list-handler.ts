import { PaginationRequestDTO } from '../dtos/common';

export abstract class ListHandler {
  public readonly defaultLimit = 20;

  public readonly defaultPage = 1;

  public getPaginationData(query: PaginationRequestDTO): { limit: number; page: number } {
    const page = query.page || this.defaultPage;
    const limit = query.limit || this.defaultLimit;

    return { page, limit };
  }
}
