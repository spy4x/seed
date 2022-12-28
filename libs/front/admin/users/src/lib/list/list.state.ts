import { User, UserRole } from '@prisma/client';
import { DefaultFilterSerializer, withListFeature } from '@seed/front/shared/state';

// export const usersState = createState(
//   { name: 'users' },
//   withListFeature<User, { role?: UserRole }>({
//     defaultSort: { field: 'createdAt', direction: 'desc' },
//     routeParams: {
//       path: '/users',
//       filterDeserializer: ({ role }) => ({ role: role as UserRole }),
//       filterSerializer: DefaultFilterSerializer,
//     },
//   }),
//   // withSelectFeature<User>(),
// );

export const usersState = withListFeature<User, { role?: UserRole }>({
  defaultSort: { field: 'createdAt', direction: 'desc' },
  routeParams: {
    path: '/users',
    filterDeserializer: ({ role }) => ({ role: role as UserRole }),
    filterSerializer: DefaultFilterSerializer,
  },
})();

export const UsersActions = usersState.actions;
export const UsersSelectors = usersState.selectors;
