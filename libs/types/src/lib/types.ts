export interface User {
  id: null | string;
  name: string;
  email: string;
  photoUrl: null | string;
}

export function createUser(user: Partial<User>): User {
  const defaultUser: User = {
    id: '1',
    name: 'Anton',
    email: '2spy4x@gmail.com',
    photoUrl: 'fake'
  };
  return Object.assign({}, defaultUser, user);
}
