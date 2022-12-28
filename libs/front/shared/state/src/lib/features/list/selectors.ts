import { createChildSelectors } from 'ngrx-child-selectors';
import { createFeatureSelector, createSelector } from '@ngrx/store';
import { LIST_FEATURE_NAME, ListFeatureConfig, ListFeatureState } from './+model';

export function createSelectors<T, TFilter>(
  config: ListFeatureConfig<T, TFilter>,
  initialState: ListFeatureState<T, TFilter>,
) {
  const { adapter } = config;

  const state = createFeatureSelector(LIST_FEATURE_NAME);

  const childSelectors = createChildSelectors(state, initialState);
  const entitySelectors = adapter.getSelectors();
  return {
    state,
    total: childSelectors.selectTotal,
    isLoading: childSelectors.selectIsLoading,
    error: childSelectors.selectError,
    page: childSelectors.selectPage,
    limit: childSelectors.selectLimit,
    filter: childSelectors.selectFilter,
    sort: childSelectors.selectSort,
    isLoadingFail: createSelector(state, state => !state.isLoading && state.error !== null),
    isLoadingSuccess: createSelector(state, state => !state.isLoading && state.error === null),
    array: entitySelectors.selectAll,
    map: entitySelectors.selectEntities,
    ids: entitySelectors.selectIds,
  };
}
