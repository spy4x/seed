export enum AuthStage {
  init = 'init',
  enterEmail = 'enterEmail',
  fetchProviders = 'fetchProviders',
  chooseProvider = 'chooseProvider',
  signUpAnonymously = 'signUpAnonymously',
  authenticateWithGoogle = 'authenticateWithGoogle',
  authenticateWithGitHub = 'authenticateWithGitHub',
  authenticateWithEmailAndPassword = 'authenticateWithEmailAndPassword',
  authenticateWithPhoneNumber = 'authenticateWithPhoneNumber',
  sendEmailLink = 'sendEmailLink',
  restorePassword = 'restorePassword',
}
