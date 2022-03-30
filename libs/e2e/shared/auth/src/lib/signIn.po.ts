import { AuthProvider } from '@seed/front/shared/types';
import { ZERO } from '@seed/shared/constants';

export class SignInPO {
  static readonly texts = {
    messages: {
      enterEmail: 'Please enter your email to continue.',
      signUp1: `It seems that we don't know each other yet.`,
      signUp2: `Choose a way to finish sign up:`,
      signedUp: `You've successfully signed up! Feel free to explore the app 🎉`,
      magicLinkSent: 'Magic link has been sent to your email. Follow it to proceed.',
    },
    buttons: {
      anonymously: 'Try app anonymously',
    },
  };

  static readonly selectors = {
    cmp: 'seed-shared-auth-container-sign-in',
    signOut: `[data-e2e="signOut"]`,
    signIn: (provider: AuthProvider): string => `button[data-e2e=${provider}]`,
    loading: `[data-e2e="loading"]`,
    emailInput: `input[data-e2e="email"]`,
    enterEmailButton: `button[data-e2e="enterEmail"]`,
    changeUserButton: `[data-e2e="changeUser"]`,
    successMessage: `[data-e2e="successMessage"]`,
    errorMessage: `[data-e2e="errorMessage"]`,
    passwordInput: `[data-e2e="${AuthProvider.password}"]`,
    enterPasswordButton: `button[data-e2e="enterPassword"]`,
    restorePasswordButton: `button[data-e2e="restorePassword"]`,
    phoneNumberInput: `[data-e2e="phoneNumber"]`,
    enterPhoneNumberButton: `button[data-e2e="enterPhoneNumber"]`,
    deselectProviderButton: `button[data-e2e="deselectProvider"]`,
  };

  get(selector?: string): Cypress.Chainable {
    const cmp = cy.get(SignInPO.selectors.cmp);
    if (selector) {
      return cmp.get(selector);
    }
    return cmp;
  }

  getSignInButton(provider: AuthProvider): Cypress.Chainable {
    return this.get(SignInPO.selectors.signIn(provider));
  }

  signIn(method: AuthProvider): Cypress.Chainable {
    return this.getSignInButton(method).click();
  }

  getSignOutButton(): Cypress.Chainable {
    return this.get(SignInPO.selectors.signOut);
  }

  signOut(): Cypress.Chainable {
    return this.getSignOutButton().click();
  }

  getLoading(): Cypress.Chainable {
    return this.get(SignInPO.selectors.loading);
  }

  signOutIfSignedIn(): void {
    const waitTime = 1500;
    cy.wait(waitTime);
    cy.document().then($document => {
      const loadingEls = $document.querySelectorAll(SignInPO.selectors.loading);
      if (loadingEls.length) {
        throw new Error(`Loading is not complete yet. Is wait time of ${waitTime}ms too small?`);
      }

      const signOutEls = $document.querySelectorAll(SignInPO.selectors.signOut);
      if (signOutEls.length) {
        (signOutEls[ZERO] as HTMLButtonElement).click();
      }
    });
  }

  enterEmail(email: string): void {
    this.get(SignInPO.selectors.emailInput).type(email);
    this.get(SignInPO.selectors.enterEmailButton).click();
  }

  getChangeUserButton(): Cypress.Chainable {
    return this.get(SignInPO.selectors.changeUserButton);
  }

  hasSuccessMessage(message: string): void {
    this.get(SignInPO.selectors.successMessage).should('contain.text', message);
  }
}
