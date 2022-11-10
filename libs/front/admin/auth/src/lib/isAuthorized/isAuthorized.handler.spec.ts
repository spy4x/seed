import { UserRole } from '@prisma/client';
import { isAuthorized } from './isAuthorized.handler';
import { mockUsers } from '@seed/shared/mock-data';

describe(isAuthorized.name, () => {
  const [testUser] = mockUsers;

  it(`returns reason for ${UserRole.USER}`, async () => {
    expect(await isAuthorized({ ...testUser, role: UserRole.USER })).toBe('User is not an Admin or Moderator.');
  });

  it(`returns true for ${UserRole.ADMIN}`, async () => {
    expect(await isAuthorized({ ...testUser, role: UserRole.ADMIN })).toBe(true);
  });

  it(`returns true for ${UserRole.MODERATOR}`, async () => {
    expect(await isAuthorized({ ...testUser, role: UserRole.MODERATOR })).toBe(true);
  });
});
