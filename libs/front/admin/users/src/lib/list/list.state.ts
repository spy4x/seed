import { createEntityFeatureFactory } from '@ngrx-traits/core';
import { User, UserRole } from '@prisma/client';
import { addEntitiesTrait, DefaultFilterSerializer } from '@seed/front/shared/state';

export const usersFeature = createEntityFeatureFactory(
  { entityName: 'user' },
  addEntitiesTrait<User, { role?: UserRole }>({
    defaultSort: { field: 'createdAt', direction: 'desc' },
    routeParams: {
      path: '/users',
      filterDeserializer: ({ role }) => ({ role: role as UserRole }),
      filterSerializer: DefaultFilterSerializer,
    },
  }),
)({
  actionsGroupKey: '[Users]',
  featureSelector: 'users',
});

export const UsersActions = usersFeature.actions;
export const UsersSelectors = usersFeature.selectors;
