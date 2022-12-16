import { createEntityFeatureFactory } from '@ngrx-traits/core';
import { User, UserRole } from '@prisma/client';
import { addEntitiesTrait } from '@seed/front/shared/state';

export const usersFeature = createEntityFeatureFactory(
  { entityName: 'user' },
  addEntitiesTrait<User, { role?: UserRole }>({
    defaultSort: { field: 'createdAt', direction: 'desc' },
    routeParamsPath: '/users',
  }),
)({
  actionsGroupKey: '[Users]',
  featureSelector: 'users',
});

export const UsersActions = usersFeature.actions;
export const UsersSelectors = usersFeature.selectors;
