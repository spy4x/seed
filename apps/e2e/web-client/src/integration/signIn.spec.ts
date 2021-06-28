import { SignInComponentPO, SignInMethods } from '../support/components/sign-in.po';

describe('Sign in', () => {
  const cmp = new SignInComponentPO();

  beforeEach(() => cy.visit('/'));

  it('shows welcome message', () => {
    cmp.get().contains(cmp.texts.messages.welcome);
    cmp.get().should('not.contain.text', cmp.texts.messages.welcomeBack);
  });

  describe(`Method: ${SignInMethods.anonymous}`, () => {
    const method = SignInMethods.anonymous;

    it('signs user in anonymously and displays welcome back text', () => {
      cmp.getButton(method).contains(cmp.texts.buttons.anonymously);
      cmp.signIn(method);
      cmp.getButton(method).should('not.exist');
      cmp.get().should('not.contain.text', cmp.texts.messages.welcome);
      cmp.get().should('contain.text', cmp.texts.messages.welcomeBack);
    });
  });
});
