import { User, UserDevice } from '@prisma/client';

export const usersMock: (User & {
  userDevices: UserDevice[];
})[] = [
  {
    id: '123456',
    userName: 'JohnDoe',
    role: 'USER',
    firstName: 'John',
    lastName: 'Doe',
    photoURL: null,
    userDevices: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    isPushNotificationsEnabled: false,
    lastTimeSignedIn: new Date(),
  },
  {
    id: '456123',
    userName: 'JaneDoe',
    role: 'USER',
    firstName: 'Jane',
    lastName: 'Doe',
    photoURL: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    userDevices: [],
    isPushNotificationsEnabled: false,
    lastTimeSignedIn: new Date(),
  },
  {
    id: '456123',
    userName: 'Jack',
    role: 'USER',
    firstName: 'Jack',
    lastName: 'Smith',
    photoURL: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    userDevices: [],
    isPushNotificationsEnabled: true,
    lastTimeSignedIn: new Date(),
  },
];
