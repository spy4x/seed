import { RouterReducerState } from '@ngrx/router-store';
import { RouterState } from './router.state';
import { initialState, ROUTER_STATE_FEATURE_KEY } from './router.constants';
import * as RouterSelectors from './router.selectors';

describe('Router Selectors', () => {
  let state: { [ROUTER_STATE_FEATURE_KEY]: RouterReducerState<RouterState> };

  beforeEach(() => (state = { [ROUTER_STATE_FEATURE_KEY]: initialState }));

  function patchState(partialNewState: Partial<RouterState>): void {
    state = {
      [ROUTER_STATE_FEATURE_KEY]: {
        ...state[ROUTER_STATE_FEATURE_KEY],
        state: { ...state[ROUTER_STATE_FEATURE_KEY].state, ...partialNewState },
      },
    };
  }

  describe('getRouterState()', () => {
    it('returns RouterState', () => {
      expect(RouterSelectors.getRouterState(state)).toBe(state[ROUTER_STATE_FEATURE_KEY]);
    });
  });

  describe('getUrl()', () => {
    it('returns state.state.url', () => {
      const url = '/my-url';
      patchState({ url });
      expect(RouterSelectors.getUrl(state)).toBe(url);
    });
    it('returns state.state.url', () => {
      const url = '/test';
      patchState({ url });
      expect(RouterSelectors.getUrl(state)).toBe(url);
    });
  });

  describe('getParams()', () => {
    it('returns state.state.params', () => {
      const params = { p1: 1, p2: '2' };
      patchState({ params });
      expect(RouterSelectors.getParams(state)).toBe(params);
    });
    it('returns state.state.params', () => {
      const params = { p3: true, p4: false };
      patchState({ params });
      expect(RouterSelectors.getParams(state)).toBe(params);
    });
  });

  describe('getQueryParams()', () => {
    it('returns state.state.queryParams', () => {
      const queryParams = { p1: 1, p2: '2' };
      patchState({ queryParams });
      expect(RouterSelectors.getQueryParams(state)).toBe(queryParams);
    });
    it('returns state.state.queryParams', () => {
      const queryParams = { p3: true, p4: false };
      patchState({ queryParams });
      expect(RouterSelectors.getQueryParams(state)).toBe(queryParams);
    });
  });
});
