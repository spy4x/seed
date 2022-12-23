import { EntitiesActions, EntitiesError, EntitiesFilter, SetParamsArgs, Sort } from './model';
import { createAction, props } from '@ngrx/store';

export function createEntitiesTraitActions<T, TFilter extends EntitiesFilter>(
  actionsGroupKey: string,
  entitiesName: string,
): EntitiesActions<T, TFilter> {
  return {
    load: createAction(`${actionsGroupKey} Load ${entitiesName}`),
    loadSuccess: createAction(
      `${actionsGroupKey} Load ${entitiesName} Success`,
      props<{ entities: T[]; total: number }>(),
    ),
    loadFail: createAction(`${actionsGroupKey} Load ${entitiesName} Fail`, props<EntitiesError>()),
    setPage: createAction(`${actionsGroupKey} Set ${entitiesName} Page`, props<{ page: number }>()),
    setFilter: createAction(`${actionsGroupKey} Set ${entitiesName} Filter`, props<{ filter: TFilter }>()),
    patchFilter: createAction(`${actionsGroupKey} Patch ${entitiesName} Filter`, props<{ filter: Partial<TFilter> }>()),
    setSort: createAction(`${actionsGroupKey} Sort ${entitiesName}`, props<{ sort: null | Sort<T> }>()),
    setLimit: createAction(`${actionsGroupKey} Set ${entitiesName} Limit`, props<{ limit: number }>()),
    setParams: createAction(`${actionsGroupKey} Set ${entitiesName} Params`, props<SetParamsArgs<T, TFilter>>()),
  };
}
