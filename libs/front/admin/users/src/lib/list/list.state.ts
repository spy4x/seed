import { addEntitiesPaginationTrait, addFilterEntitiesTrait, addLoadEntitiesTrait } from '@ngrx-traits/common';
import { createEntityFeatureFactory } from '@ngrx-traits/core';
import { User, UserRole } from '@prisma/client';
import { PAGINATION_DEFAULTS, ZERO } from '@seed/shared/constants';

export const usersFeature = createEntityFeatureFactory(
  { entityName: 'user' },
  addLoadEntitiesTrait<User>(),
  addEntitiesPaginationTrait<User>({ pageSize: PAGINATION_DEFAULTS.limit, pagesToCache: 1, cacheType: 'partial' }),
  addFilterEntitiesTrait<User, { role: UserRole }>({ defaultDebounceTime: ZERO }),
)({
  actionsGroupKey: '[Users]',
  featureSelector: 'users',
});

export const UsersActions = usersFeature.actions;
export const UsersSelectors = usersFeature.selectors;
