import { EntitiesState, EntitiesTraitKeyedConfig } from './model';
import { PAGINATION_DEFAULTS, ZERO } from '@seed/shared/constants';

export function createEntitiesInitialState<T, TFilter>(
  previousInitialState = {},
  allConfigs: EntitiesTraitKeyedConfig<T, TFilter>,
): EntitiesState<T, TFilter> {
  const traitConfig = allConfigs.entities!;
  const adapter = traitConfig.adapter;

  return {
    ...previousInitialState,
    ...adapter!.getInitialState(),
    total: ZERO,
    isLoading: false,
    error: null,
    page: PAGINATION_DEFAULTS.page,
    limit: traitConfig.limit || PAGINATION_DEFAULTS.limit,
    filter: traitConfig.defaultFilter || ({} as TFilter),
    sort: traitConfig.defaultSort || null,
  };
}
