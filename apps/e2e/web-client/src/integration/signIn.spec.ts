import { SignInComponentPO, SignInMethods } from '../support/components/sign-in.po';

describe('Sign in', () => {
  const cmp = new SignInComponentPO();

  beforeEach(() => cy.visit('/'));

  describe(`Method: ${SignInMethods.anonymous}`, () => {
    const method = SignInMethods.anonymous;

    it('signs user in anonymously, displays welcome back text and signs out', () => {
      // not authenticated
      cmp.get().contains(cmp.texts.messages.welcome);
      cmp.get().should('not.contain.text', cmp.texts.messages.welcomeBack);

      // sign in
      cmp.getSignInButton(method).contains(cmp.texts.buttons.anonymously);
      cmp.signIn(method);
      cmp.getSignInButton(method).should('not.exist');
      cmp.get().should('not.contain.text', cmp.texts.messages.welcome);
      cmp.get().should('contain.text', cmp.texts.messages.welcomeBack);

      // sign out
      cmp.signOut();
      cmp.get().should('contain.text', cmp.texts.messages.welcome);
    });
  });
});
