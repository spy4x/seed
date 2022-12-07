import { User, UserRole } from '@prisma/client';
import { nowMock } from './time.mock';
import { ONE, TWO, ZERO } from '@seed/shared/constants';
import * as faker from 'faker';

const MAX_USERS = 25;
const mockUsers: User[] = [];

for (let i = ZERO; i < MAX_USERS; i++) {
  mockUsers.push({
    id: (i + ONE).toString(),
    userName: faker.internet.userName(),
    role: i <= TWO ? UserRole.ADMIN : UserRole.USER,
    firstName: faker.name.firstName(),
    lastName: faker.name.lastName(),
    photoURL: `https://i.pravatar.cc/150?img=${i}`,
    createdAt: nowMock,
    updatedAt: nowMock,
    isPushNotificationsEnabled: false,
    lastTimeSignedIn: nowMock,
  });
}

export { mockUsers };
