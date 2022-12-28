import {
  LIST_FEATURE_NAME,
  ListFeatureConfig,
  ListFeatureError,
  ListFeatureState,
  SetParamsArgs,
  Sort,
} from './+model';
import { combineHandlers } from 'ngrx-handlers';
import { PAGINATION_DEFAULTS } from '@seed/shared/constants';

export function createActionsAndReducer<T, TFilter>(
  config: ListFeatureConfig<T, TFilter>,
  initialState: ListFeatureState<T, TFilter>,
) {
  const { adapter } = config;
  return combineHandlers(initialState, LIST_FEATURE_NAME, {
    load: state => ({
      ...state,
      isLoading: true,
      error: null,
    }),
    loadFail: (state, { error }: { error: ListFeatureError }) => ({
      ...state,
      isLoading: false,
      error,
    }),
    loadSuccess: (state, { entities, total }: { entities: T[]; total: number }) => ({
      ...state,
      ...adapter.setAll(entities, state),
      isLoading: false,
      total,
    }),
    setPage: (state, { page }: { page: number }) => ({
      ...state,
      page,
    }),
    setFilter: (state, { filter }: { filter: TFilter }) => ({
      ...state,
      filter,
      page: PAGINATION_DEFAULTS.page,
    }),
    patchFilter: (state, { filter }: { filter: TFilter }) => ({
      ...state,
      filter: {
        ...state.filter,
        ...filter,
      },
      page: PAGINATION_DEFAULTS.page,
    }),
    setSort: (state, { sort }: { sort: Sort<T> }) => ({
      ...state,
      sort,
    }),
    setLimit: (state, { limit }: { limit: number }) => ({
      ...state,
      limit,
      page: PAGINATION_DEFAULTS.page,
    }),
    setParams: (state, { page, limit, filter, sort }: SetParamsArgs<T, TFilter>) => ({
      ...state,
      page: page ?? PAGINATION_DEFAULTS.page,
      limit: limit ?? state.limit,
      filter: filter ?? state.filter,
      sort: sort === null ? null : sort ?? state.sort,
    }),
  });
}
