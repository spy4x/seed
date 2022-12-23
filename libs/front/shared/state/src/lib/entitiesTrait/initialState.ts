import { EntitiesState, EntitiesTraitKeyedConfig } from './model';
import { PAGINATION_DEFAULTS, ZERO } from '@seed/shared/constants';

export function createEntitiesInitialState<T, TFilter>(
  allConfigs: EntitiesTraitKeyedConfig<T, TFilter>,
  previousInitialState = {},
): EntitiesState<T, TFilter> {
  /* eslint-disable-next-line @typescript-eslint/no-non-null-assertion */
  const traitConfig = allConfigs.entities!;
  const { adapter } = traitConfig;

  return {
    ...previousInitialState,
    ...adapter.getInitialState(),
    total: ZERO,
    isLoading: false,
    error: null,
    page: PAGINATION_DEFAULTS.page,
    limit: traitConfig.limit || PAGINATION_DEFAULTS.limit,
    filter: traitConfig.defaultFilter || ({} as TFilter),
    sort: traitConfig.defaultSort || null,
  };
}
