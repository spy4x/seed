import { PaginationRequestDTO } from '../../dtos';
import { ONE, PAGINATION_DEFAULTS } from '@seed/shared/constants';

export abstract class ListHandler {
  public getPaginationData(query: PaginationRequestDTO): { limit: number; page: number } {
    const page = query.page || PAGINATION_DEFAULTS.page;
    const limit = query.limit || PAGINATION_DEFAULTS.limit;
    return { page, limit };
  }

  public getPrismaTakeAndSkip(query: PaginationRequestDTO): { take: number; skip: number } {
    return {
      take: query.limit,
      skip: query.limit * (query.page - ONE),
    };
  }
}
