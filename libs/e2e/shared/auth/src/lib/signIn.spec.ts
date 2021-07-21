import { AuthProvider, AuthStage } from '@seed/front/shared/types';
import { SignInPO } from './signIn.po';

export function runTest(): void {
  describe('Sign in', () => {
    // region SETUP
    const cmp = new SignInPO();

    before(() => {
      cy.visit('/');
      cmp.signOutIfSignedIn();
    });

    beforeEach(() => cy.visit('/'));

    function getRandomEmail(): string {
      return `${Math.random().toString().replace('0.', '')}@test.com`;
    }

    function checkAllProvidersAreVisible() {
      const signUpProviders = (Object.keys(AuthProvider) as AuthProvider[]).filter(ap => ap !== AuthProvider.anonymous);
      signUpProviders.forEach(p => {
        cmp.get(SignInPO.selectors.signIn(p)).should('exist');
      });
    }
    // endregion

    it('shows "enterEmail" text & is not authenticated', () => {
      cmp.get().contains(SignInPO.texts.messages.enterEmail);
      cmp.get().should('not.contain.text', SignInPO.texts.messages.signedUp);
    });

    describe(`Method: ${AuthProvider.anonymous}`, () => {
      const method = AuthProvider.anonymous;
      it('signs user in anonymously, displays "SignedUp" text and signs out', () => {
        // sign in
        cmp.getSignInButton(method).contains(SignInPO.texts.buttons.anonymously);
        cmp.signIn(method);
        cmp.getSignInButton(method).should('not.exist');
        cmp.get().should('not.contain.text', SignInPO.texts.messages.enterEmail);
        cmp.get().should('contain.text', SignInPO.texts.messages.signedUp);
        // sign out
        cmp.signOut();
        cmp.get().should('contain.text', SignInPO.texts.messages.enterEmail);
      });
    });

    describe(`Stage: ${AuthStage.enteringEmail}`, () => {
      it('enters email, displays all available providers and then changes user', () => {
        // enter email
        cmp.get().should('contain.text', SignInPO.texts.messages.enterEmail);
        const email = getRandomEmail();
        cmp.enterEmail(email);
        cmp.get().should('contain.text', SignInPO.texts.messages.signUp1);
        cmp.get().should('contain.text', SignInPO.texts.messages.signUp2);
        cmp.get().should('contain.text', email);
        cmp.getChangeUserButton().should('exist');

        // check all providers buttons are visible
        checkAllProvidersAreVisible();

        // clean up
        cmp.getChangeUserButton().click();
        cmp.get().should('contain.text', SignInPO.texts.messages.enterEmail);
      });

      it('checks "Magic Link" auth sends email', () => {
        const email = getRandomEmail();
        cmp.enterEmail(email);
        // check link auth
        cmp.signIn(AuthProvider.link);
        cmp.hasSuccessMessage(SignInPO.texts.messages.magicLinkSent);
        // clean up
        cmp.getChangeUserButton().click();
        cmp.get().should('contain.text', SignInPO.texts.messages.enterEmail);
      });

      it('checks "Password" auth renders', () => {
        const email = getRandomEmail();
        cmp.enterEmail(email);
        // check password auth renders
        cmp.signIn(AuthProvider.password);
        cmp.get(SignInPO.selectors.passwordInput).should('exist');
        cmp.get(SignInPO.selectors.enterPasswordButton).should('exist');
        cmp.get(SignInPO.selectors.restorePasswordButton).should('exist');
        // go back to all providers
        cmp.get(SignInPO.selectors.deselectProviderButton).click();
        checkAllProvidersAreVisible();
        // clean up
        cmp.getChangeUserButton().click();
        cmp.get().should('contain.text', SignInPO.texts.messages.enterEmail);
      });

      it('checks "Phone" auth renders', () => {
        const email = getRandomEmail();
        cmp.enterEmail(email);
        // check password auth renders
        cmp.signIn(AuthProvider.phone);
        cmp.get(SignInPO.selectors.phoneNumberInput).should('exist');
        cmp.get(SignInPO.selectors.enterPhoneNumberButton).should('exist');
        // go back to all providers
        cmp.get(SignInPO.selectors.deselectProviderButton).click();
        checkAllProvidersAreVisible();
        // clean up
        cmp.getChangeUserButton().click();
        cmp.get().should('contain.text', SignInPO.texts.messages.enterEmail);
      });
    });
  });
}
