import { IsAuthorizedHandler } from '@seed/front/shared/auth/state';
import { User, UserRole } from '@prisma/client';

export const isAuthorized: IsAuthorizedHandler = async (user: User) =>
  Promise.resolve(
    ([UserRole.ADMIN, UserRole.MODERATOR] as UserRole[]).includes(user.role)
      ? true
      : 'User is not an Admin or Moderator.',
  );
