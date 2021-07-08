export enum AuthMethods {
  anonymous = 'anonymous',
  google = 'google',
  facebook = 'facebook',
  github = 'github',
  password = 'password',
  link = 'link',
  /**
   * System method for initial check of user state on app start
   */
  init = 'init',
}
