export enum AuthStage {
  init = 'init',
  enterEmail = 'enterEmail',
  fetchProviders = 'fetchProviders',
  chooseProvider = 'chooseProvider',
  signUp = 'signUp',
  authenticateAnonymously = 'authenticateAnonymously',
  authenticateWithGoogle = 'authenticateWithGoogle',
  authenticateWithGitHub = 'authenticateWithGitHub',
  authenticateWithEmailAndPassword = 'authenticateWithEmailAndPassword',
  authenticateWithPhoneNumber = 'authenticateWithPhoneNumber',
  sendEmailLink = 'sendEmailLink',
  restorePassword = 'restorePassword',
}
