import { createUser, User } from '@afs/types';

/**
 * Fake user to run checks against
 */
const user: User = {
  email: '2',
  id: '1',
  name: '1',
  photoUrl: '3'
};

describe('User interface', () => {
  it('user has name', () => {
    expect(user.name).toBe('1');
  });
});

describe('createUser()', () => {
  it('default user has name', () => {
    expect(createUser({}).name).toBe('Anton');
  });
});
