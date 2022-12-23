import { Comparer, Dictionary, EntityAdapter, EntityState, IdSelector } from '@ngrx/entity';
import { KeyedConfig, TraitActions, TraitSelectors } from '@ngrx-traits/core';
import { ActionCreator, TypedAction } from '@ngrx/store/src/models';
import { Params } from '@angular/router';

export const entitiesTraitKey = 'entities';

export interface LoadSuccess<T> {
  entities: T[];
  total: number;
}

/* eslint-disable-next-line @typescript-eslint/no-empty-interface */
export interface EntitiesFilter {}

export const DefaultFilterSerializer = <TFilter>(filter: TFilter): Params => {
  return { ...filter } as Params;
};

export interface EntitiesTraitConfig<T, TFilter> {
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

export type EntitiesTraitConfigWithoutAdapter<T, TFilter> = Omit<EntitiesTraitConfig<T, TFilter>, 'adapter'>;

export type EntitiesTraitKeyedConfig<T, TFilter> = KeyedConfig<
  typeof entitiesTraitKey,
  EntitiesTraitConfig<T, TFilter>
>;

export interface EntitiesStateExtra<T, TFilter> {
  limit: number;
  page: number;
  total: number;
  isLoading: boolean;
  filter: TFilter;
  sort: null | Sort<T>;
  error: null | EntitiesError;
}

export interface EntitiesState<T, TFilter> extends EntityState<T>, EntitiesStateExtra<T, TFilter> {}

export interface EntitiesError {
  message: string;
  code?: string;
}

export declare type SortDirection = 'asc' | 'desc';

export interface Sort<T> {
  /** The field of the entity being sorted. */
  field: keyof T;
  /** The sort direction. */
  direction: SortDirection;
}

export interface EntitiesSelectors<T, TFilter> extends TraitSelectors<EntitiesState<T, TFilter>> {
  state: (state: EntitiesState<T, TFilter>) => EntitiesState<T, TFilter>;
  /**
   * returns all ids of the entities in an array
   * @param state
   */
  ids: (state: EntitiesState<T, TFilter>) => string[] | number[];
  /**
   * returns all entities in a map with the id as key of the map
   * @param state
   */
  map: (state: EntitiesState<T, TFilter>) => Dictionary<T>;
  /**
   * returns all entities in an array
   * @param state
   */
  array: (state: EntitiesState<T, TFilter>) => T[];
  /**
   * returns the total number of entities
   * @param state
   */
  total: (state: EntitiesState<T, TFilter>) => number;
  /**
   * returns the current page
   * @param state
   */
  page: (state: EntitiesState<T, TFilter>) => number;
  /**
   * returns the limit of entities per page
   * @param state
   */
  limit: (state: EntitiesState<T, TFilter>) => number;
  /**
   * returns the current filter
   * @param state
   */
  filter: (state: EntitiesState<T, TFilter>) => TFilter;
  /**
   * returns the current filter
   * @param state
   */
  sort: (state: EntitiesState<T, TFilter>) => null | Sort<T>;
  /**
   * returns loading error
   * @param state
   */
  error: (state: EntitiesState<T, TFilter>) => null | EntitiesError;
  /**
   * is currently loading entities
   * @param state
   */
  isLoading: (state: EntitiesState<T, TFilter>) => boolean;
  /**
   * were the entities loaded successfully
   * @param state
   */
  isLoadingSuccess: (state: EntitiesState<T, TFilter>) => boolean;
  /**
   * did the entities fail loading
   * @param state
   */
  isLoadingFail: (state: EntitiesState<T, TFilter>) => boolean;
}

export interface SetParamsArgs<T, TFilter extends EntitiesFilter> {
  page?: number;
  limit?: number;
  filter?: TFilter;
  sort?: null | Sort<T>;
}

export interface EntitiesActions<T, TFilter extends EntitiesFilter> extends TraitActions {
  setPage: ActionCreator<string, (props: { page: number }) => { page: number } & TypedAction<string>>;
  patchFilter: ActionCreator<
    string,
    (props: { filter: Partial<TFilter> }) => { filter: Partial<TFilter> } & TypedAction<string>
  >;
  setFilter: ActionCreator<string, (props: { filter: TFilter }) => { filter: TFilter } & TypedAction<string>>;
  setSort: ActionCreator<string, (props: { sort: null | Sort<T> }) => { sort: null | Sort<T> } & TypedAction<string>>;
  setLimit: ActionCreator<string, (props: { limit: number }) => { limit: number } & TypedAction<string>>;
  setParams: ActionCreator<
    string,
    (props: SetParamsArgs<T, TFilter>) => SetParamsArgs<T, TFilter> & TypedAction<string>
  >;
  load: ActionCreator<string, () => TypedAction<string>>;
  loadSuccess: ActionCreator<string, (props: LoadSuccess<T>) => LoadSuccess<T> & TypedAction<string>>;
  loadFail: ActionCreator<string, (props: EntitiesError) => EntitiesError & TypedAction<string>>;
}
