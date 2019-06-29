import { createUser, User } from '@afs/types';

const user: User = {
  id: '1',
  name: '1',
  email: '2',
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
