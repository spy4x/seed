import { createSelector } from '@ngrx/store';
import { EntitiesSelectors, EntitiesState, EntitiesTraitKeyedConfig } from './model';

export function createEntitiesTraitSelectors<T, TFilter>(
  allConfigs: EntitiesTraitKeyedConfig<T, TFilter>,
): EntitiesSelectors<T, TFilter> {
  /* eslint-disable-next-line @typescript-eslint/no-non-null-assertion */
  const { adapter } = allConfigs.entities!;
  const entitySelectors = adapter.getSelectors();

  function selectState(state: EntitiesState<T, TFilter>): EntitiesState<T, TFilter> {
    return state;
  }

  return {
    state: selectState,
    array: entitySelectors.selectAll,
    map: entitySelectors.selectEntities,
    ids: entitySelectors.selectIds,
    total: createSelector(selectState, state => state.total),
    isLoading: createSelector(selectState, state => state.isLoading),
    isLoadingFail: createSelector(selectState, state => !state.isLoading && state.error !== null),
    isLoadingSuccess: createSelector(selectState, state => !state.isLoading && state.error === null),
    error: createSelector(selectState, state => state.error),
    page: createSelector(selectState, state => state.page),
    limit: createSelector(selectState, state => state.limit),
    filter: createSelector(selectState, state => state.filter),
    sort: createSelector(selectState, state => state.sort),
  };
}
