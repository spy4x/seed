import { AsyncOperationTraitConfig } from './model';
import { createTraitFactory } from '@ngrx-traits/core';
import { combineHandlers } from 'ngrx-handlers';
import { createChildSelectors } from 'ngrx-child-selectors';
import { Action, createSelector } from '@ngrx/store';

/**
 * Generates ngrx code to manage a list of entities, with pagination, filters, sorting options, etc.
 * Watches for route changes and updates the state accordingly.
 * @param config
 * @param config.limit - Number of entities on each page
 *
 * @example
 * // The following trait config
 * export interface Todo {
 *   id: string;
 *   title: string;
 *   completed: boolean;
 * }
 *
 * export interface TodoFilter {
 *   title?: string;
 *   completed?: boolean;
 * }
 *
 * export interface TodoState
 * extends EntitiesState<Todo>{}
 *
 *    const traits = createEntityFeatureFactory(
 *      {entityName: 'Todo'},
 *      addEntitiesTrait<Todo, TodoFilter>({limit: 20})
 *    )({
 *      actionsGroupKey: '[Todos]',
 *      featureSelector: createFeatureSelector<TodoState>>(
 *        'todos',
 *      ),
 *    });
 *
 * //   adds following props to the state:
 * //    limit: number;
 * //    page: number;
 * //    total: number;
 * //    isLoading: boolean;
 *
 * // generated actions
 * traits.actions.set({page, filter, sort})
 * traits.actions.setPage({page})
 * traits.actions.setFilter({filter})
 * traits.actions.patchFilter({filter})
 * traits.actions.setSort({field, direction})
 * traits.actions.setLimit({limit})
 * traits.actions.setParams({limit, page, filter, sort})
 * traits.actions.load()
 * traits.actions.loadSuccess({entities: todos, total: 100})
 * traits.actions.loadFail({error: {message:'error', code: '500'}});
 *
 * // generated selectors
 * traits.selectors.ids()
 * traits.selectors.map()
 * traits.selectors.array()
 * traits.selectors.total()
 * traits.selectors.page()
 * traits.selectors.limit()
 * traits.selectors.filter()
 * traits.selectors.sort()
 * traits.selectors.error()
 * traits.selectors.isLoading()
 * traits.selectors.isLoadingSuccess()
 * traits.selectors.isLoadingFail()
 */

/* eslint-disable-next-line @typescript-eslint/explicit-function-return-type */
export function addAsyncOperationTrait(config: AsyncOperationTraitConfig) {
  interface AsyncOperationTraitState {
    status: null | 'running' | 'success' | 'error';
    runningWith: null | typeof config.runningProps;
    result: null | typeof config.successProps;
    error: null | typeof config.errorProps;
  }

  const initialState: AsyncOperationTraitState = {
    status: null,
    runningWith: null,
    error: null,
    result: null,
  };

  const [actions, reducer] = combineHandlers(initialState, config.name, {
    start: (state, action: Action & typeof config.runningProps) => ({
      ...state,
      status: 'running',
      runningWith: action,
      error: null,
      result: null,
    }),
    success: (state, action: Action & typeof config.successProps) => ({
      ...state,
      status: 'success',
      result: action,
    }),
    error: (state, action: Action & typeof config.errorProps) => ({
      ...state,
      status: 'error',
      error: action,
    }),
    reset: () => initialState,
  });

  function selectState(state: AsyncOperationTraitState): AsyncOperationTraitState {
    return state;
  }

  const selectorsInner = createChildSelectors(state => state, initialState);

  const selectors = {
    status: selectorsInner.selectStatus,
    runningWith: selectorsInner.selectRunningWith,
    result: selectorsInner.selectResult,
    error: selectorsInner.selectError,
    isNotYetStarted: createSelector(selectState, state => state.status === null),
    isRunning: createSelector(selectState, state => state.status === 'running'),
    isSuccess: createSelector(selectState, state => state.status === 'success'),
    isError: createSelector(selectState, state => state.status === 'error'),
  } as const;

  return createTraitFactory({
    key: config.name,
    config,
    actions: () => actions,
    selectors: () => selectors as any,
    initialState: ({ previousInitialState }) => ({ ...previousInitialState, ...initialState }),
    reducer: () => reducer,
    // effects: ({ allActions, allSelectors, allConfigs }) =>
    //   createEntitiesTraitEffects<T, TFilter>(allActions, allConfigs, allSelectors),
  });
}
