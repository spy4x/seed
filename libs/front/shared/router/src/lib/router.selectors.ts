import { RouterReducerState } from '@ngrx/router-store';
import { createFeatureSelector, createSelector } from '@ngrx/store';
import { ROUTER_STATE_FEATURE_KEY } from './router.constants';
import { RouterState } from './router.state';

type State = RouterReducerState<RouterState>;
export const getRouterState = createFeatureSelector<State>(ROUTER_STATE_FEATURE_KEY);
export const getUrl = createSelector(getRouterState, (state: State) => state.state.url);
export const getParams = createSelector(getRouterState, (state: State) => state.state.params);
export const getQueryParams = createSelector(getRouterState, (state: State) => state.state.queryParams);
