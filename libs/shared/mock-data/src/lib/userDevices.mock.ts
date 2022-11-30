import { UserDevice } from '@prisma/client';
import { mockUsers } from './users.mock';
import { getUUID } from '@seed/shared/helpers';
import { ONE, ZERO } from '@seed/shared/constants';
import { nowMock } from './time.mock';

const firstUserId = mockUsers[ZERO].id;
const secondUserId = mockUsers[ONE].id;

export const mockUserDevices: UserDevice[] = [
  {
    id: getUUID(),
    userId: firstUserId,
    deviceId: 'd1',
    deviceName: 'device 1',
    fcmToken: 'token1',
    createdAt: nowMock,
    updatedAt: nowMock,
  },
  {
    id: getUUID(),
    userId: firstUserId,
    deviceId: 'd2',
    deviceName: 'device 2',
    fcmToken: 'token2',
    createdAt: nowMock,
    updatedAt: nowMock,
  },
  {
    id: getUUID(),
    userId: secondUserId,
    deviceId: 'd3',
    deviceName: 'device 3',
    fcmToken: 'token3',
    createdAt: nowMock,
    updatedAt: nowMock,
  },
];
