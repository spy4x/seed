import { AuthMethod } from '@seed/front/shared/types';
import { SignInPO } from './signIn.po';

export function runTest(): void {
  describe('Sign in', () => {
    const cmp = new SignInPO();

    beforeEach(() => {
      cy.visit('/');
    });

    it('shows welcome text & is not authenticated', () => {
      cmp.get().contains(cmp.texts.messages.welcome);
      cmp.get().should('not.contain.text', cmp.texts.messages.welcomeBack);
    });

    describe(`Method: ${AuthMethod.anonymous}`, () => {
      const method = AuthMethod.anonymous;
      it('signs user in anonymously, displays welcome back text and signs out', () => {
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
}
