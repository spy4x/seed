import { PAGINATION_DEFAULTS, ZERO } from '@seed/shared/constants';
import { ListFeatureConfig, ListFeatureState } from './+model';

export function createInitialState<T, TFilter>(config: ListFeatureConfig<T, TFilter>): ListFeatureState<T, TFilter> {
  const { adapter } = config;
  return {
    ...adapter.getInitialState(),
    total: ZERO,
    isLoading: false,
    error: null,
    page: PAGINATION_DEFAULTS.page,
    limit: config.limit || PAGINATION_DEFAULTS.limit,
    filter: config.defaultFilter || ({} as TFilter),
    sort: config.defaultSort || null,
  };
}
