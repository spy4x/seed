import { EntitiesActions, EntitiesFilter, EntitiesState, EntitiesTraitKeyedConfig } from './model';
import { ActionReducer, createReducer, on } from '@ngrx/store';
import { PAGINATION_DEFAULTS } from '@seed/shared/constants';

/* eslint-disable-next-line max-lines-per-function */
export function createEntitiesTraitReducer<T, TFilter extends EntitiesFilter>(
  initialState: EntitiesState<T, TFilter>,
  actions: EntitiesActions<T, TFilter>,
  allConfigs: EntitiesTraitKeyedConfig<T, TFilter>,
): ActionReducer<EntitiesState<T, TFilter>> {
  /* eslint-disable-next-line @typescript-eslint/no-non-null-assertion */
  const { adapter } = allConfigs.entities!;
  return createReducer<EntitiesState<T, TFilter>>(
    initialState,
    on(actions.load, state => ({
      ...state,
      isLoading: true,
      error: null,
    })),
    on(actions.loadFail, (state, error) => ({
      ...state,
      isLoading: false,
      error,
    })),
    on(actions.loadSuccess, (state, { entities, total }) => ({
      ...state,
      ...adapter.setAll(entities, state),
      isLoading: false,
      total,
    })),
    on(actions.setPage, (state, { page }) => ({
      ...state,
      page,
    })),
    on(actions.setFilter, (state, { filter }) => ({
      ...state,
      filter,
      page: PAGINATION_DEFAULTS.page,
    })),
    on(actions.patchFilter, (state, { filter }) => ({
      ...state,
      filter: {
        ...state.filter,
        ...filter,
      },
      page: PAGINATION_DEFAULTS.page,
    })),
    on(actions.setSort, (state, { sort }) => ({
      ...state,
      sort,
    })),
    on(actions.setLimit, (state, { limit }) => ({
      ...state,
      limit,
      page: PAGINATION_DEFAULTS.page,
    })),
    on(actions.setParams, (state, { page, limit, filter, sort }) => ({
      ...state,
      page: page ?? PAGINATION_DEFAULTS.page,
      limit: limit ?? state.limit,
      filter: filter ?? state.filter,
      sort: sort === null ? null : sort ?? state.sort,
    })),
  );
}
