import { User } from '@prisma/client';
import { nowMock } from './time.mock';

export const mockUsers: User[] = [
  {
    id: '123456',
    userName: 'JohnDoe',
    role: 'USER',
    firstName: 'John',
    lastName: 'Doe',
    photoURL: null,
    createdAt: nowMock,
    updatedAt: nowMock,
    isPushNotificationsEnabled: false,
    lastTimeSignedIn: nowMock,
  },
  {
    id: '456123',
    userName: 'JaneDoe',
    role: 'USER',
    firstName: 'Jane',
    lastName: 'Doe',
    photoURL: null,
    createdAt: nowMock,
    updatedAt: nowMock,
    isPushNotificationsEnabled: false,
    lastTimeSignedIn: nowMock,
  },
  {
    id: '456123',
    userName: 'Jack',
    role: 'USER',
    firstName: 'Jack',
    lastName: 'Smith',
    photoURL: null,
    createdAt: nowMock,
    updatedAt: nowMock,
    isPushNotificationsEnabled: true,
    lastTimeSignedIn: nowMock,
  },
];
