import { RouterState } from './router.state';
import { RouterReducerState } from '@ngrx/router-store';

export const ROUTER_STATE_FEATURE_KEY = 'router';
export const initialState: RouterReducerState<RouterState> = {
  state: {
    url: window.location.pathname,
    params: {},
    queryParams: {},
  },
  navigationId: 0,
};
