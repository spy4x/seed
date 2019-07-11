/**
 * Basic entity interface, that describes fields that all entities have
 */
export interface BaseEntity {
  /**
   * Unique identifier for entity in database
   */
  id: null | string;
}

/**
 * Application User entity with public fields
 */
export interface User extends BaseEntity {
  /**
   * Email used for displaying in UI and communicating with the user
   */
  email: string;
  /**
   * Full name
   */
  name: string;
  /**
   * URL to avatar image
   */
  photoUrl: null | string;
}

/**
 * Returns new User object with default fields
 * @param user fields to be overwritten
 */
export const createUser = (user: Partial<User>): User => {
  const defaultUser: User = {
    email: '2spy4x@gmail.com',
    id: '1',
    name: 'Anton',
    photoUrl: 'fake'
  };

  return { ...defaultUser, ...user };
};
