import { RouterReducerState } from '@ngrx/router-store';
import { createFeatureSelector, createSelector } from '@ngrx/store';
import { ROUTER_STATE_FEATURE_KEY } from './router.constants';
import { RouterState } from './router.state';

type State = RouterReducerState<RouterState>;
export const getFeatureState = createFeatureSelector<State>(ROUTER_STATE_FEATURE_KEY);
export const getState = createSelector(getFeatureState, (state: State) => state.state);
export const getUrl = createSelector(getFeatureState, (state: State) => state.state.url);
export const getParams = createSelector(getFeatureState, (state: State) => state.state.params);
export const getQueryParams = createSelector(getFeatureState, (state: State) => state.state.queryParams);
