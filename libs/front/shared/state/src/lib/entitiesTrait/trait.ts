import {
  EntitiesTraitConfig,
  EntitiesTraitConfigWithoutAdapter,
  entitiesTraitKey,
  EntitiesTraitKeyedConfig,
} from './model';
import {
  createTraitFactory,
  TraitActionsFactoryConfig,
  TraitInitialStateFactoryConfig,
  TraitSelectorsFactoryConfig,
} from '@ngrx-traits/core';
import { createEntityAdapter, EntityAdapter } from '@ngrx/entity';
import { createEntitiesTraitActions } from './actions';
import { createEntitiesTraitSelectors } from './selectors';
import { createEntitiesInitialState } from './initialState';
import { createEntitiesTraitReducer } from './reducer';
import { createEntitiesTraitEffects } from './effects';

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
export function addEntitiesTrait<T, TFilter>(config: EntitiesTraitConfigWithoutAdapter<T, TFilter>) {
  const adapter: EntityAdapter<T> = createEntityAdapter(config);
  const configFull: EntitiesTraitConfig<T, TFilter> = { adapter, ...config };

  return createTraitFactory({
    key: entitiesTraitKey,
    config: configFull,
    actions: ({ actionsGroupKey, entitiesName }: TraitActionsFactoryConfig) =>
      createEntitiesTraitActions<T, TFilter>(actionsGroupKey, entitiesName),
    selectors: ({ allConfigs }: TraitSelectorsFactoryConfig) =>
      createEntitiesTraitSelectors<T, TFilter>(allConfigs as EntitiesTraitKeyedConfig<T, TFilter>),
    initialState: ({ previousInitialState, allConfigs }: TraitInitialStateFactoryConfig) =>
      createEntitiesInitialState<T, TFilter>(previousInitialState, allConfigs),
    reducer: ({ initialState, allActions, allConfigs }) =>
      createEntitiesTraitReducer<T, TFilter>(
        initialState,
        allActions,
        allConfigs as EntitiesTraitKeyedConfig<T, TFilter>,
      ),
    effects: ({ allActions, allSelectors, allConfigs }) =>
      createEntitiesTraitEffects<T, TFilter>(allActions, allConfigs, allSelectors),
  });
}
