import { Prisma } from '@prisma/client';

export const CurrentUserSelector: Prisma.UserSelect = {
  id: true,
  userName: true,
  firstName: true,
  lastName: true,
  photoURL: true,
  isPushNotificationsEnabled: true,
  createdAt: true,
  updatedAt: true,
};
