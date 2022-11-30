import { Notification, NotificationType } from '@prisma/client';
import { mockUsers } from './users.mock';
import { getUUID } from '@seed/shared/helpers';
import { ONE, ZERO } from '@seed/shared/constants';
import { nowMock } from './time.mock';

const firstUserId = mockUsers[ZERO].id;
const secondUserId = mockUsers[ONE].id;

export const mockNotifications: Notification[] = [
  {
    id: getUUID(),
    userId: firstUserId,
    type: NotificationType.WELCOME,
    isRead: false,
    createdAt: nowMock,
    updatedAt: nowMock,
  },
  {
    id: getUUID(),
    userId: firstUserId,
    type: NotificationType.TEST,
    isRead: false,
    createdAt: nowMock,
    updatedAt: nowMock,
  },
  {
    id: getUUID(),
    userId: secondUserId,
    type: NotificationType.WELCOME,
    isRead: false,
    createdAt: nowMock,
    updatedAt: nowMock,
  },
];
