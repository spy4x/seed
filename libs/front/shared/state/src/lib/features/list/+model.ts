import { Params } from '@angular/router';
import { Comparer, EntityAdapter, EntityState, IdSelector } from '@ngrx/entity';

export const LIST_FEATURE_NAME = 'list';

export declare type SortDirection = 'asc' | 'desc';

export interface Sort<T> {
  /** The field of the entity being sorted. */
  field: keyof T;
  /** The sort direction. */
  direction: SortDirection;
}

export interface ListFeatureError {
  message: string;
  code?: string;
}

export interface ListFeatureConfig<T, TFilter> {
  limit?: number;
  defaultFilter?: TFilter;
  defaultSort?: Sort<T>;
  /**
   * URL params to watch for changes.
   * Example: {path:"/users", filterDeserializer: ({role}) => ({ role: role as UserRole }), filterSerializer: DefaultFilterSerializer} - will watch for filter, sort, page changes in the url, like "/users?page=2&limit=25&sortField=firstName&sortDirection=desc&role=ADMIN"
   */
  routeParams?: {
    path: string;
    filterDeserializer: (params: Params) => TFilter;
    filterSerializer: (filter: TFilter) => Params;
  };
  /**
   * Function that returns the id of an entity if not set it attempts to return the values
   * of a property call id, this is pass to @ngrx/entity EntityAdapter
   */
  selectId?: IdSelector<T>;
  /**
   *  Default sort function for to @ngrx/entity EntityAdapter
   */
  sortComparer?: false | Comparer<T>;
  /**
   *  @ngrx/entity EntityAdapter
   */
  adapter: EntityAdapter<T>;
}

export type ListFeatureConfigWithoutAdapter<T, TFilter> = Omit<ListFeatureConfig<T, TFilter>, 'adapter'>;

export interface ListFeatureStateExtra<T, TFilter> {
  limit: number;
  page: number;
  total: number;
  isLoading: boolean;
  filter: TFilter;
  sort: null | Sort<T>;
  error: null | ListFeatureError;
}

export interface ListFeatureState<T, TFilter> extends EntityState<T>, ListFeatureStateExtra<T, TFilter> {}

export interface SetParamsArgs<T, TFilter> {
  page?: number;
  limit?: number;
  filter?: TFilter;
  sort?: null | Sort<T>;
}

export const DefaultFilterSerializer = <TFilter>(filter: TFilter): Params => {
  return { ...filter } as Params;
};
