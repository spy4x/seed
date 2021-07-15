import { AuthProvider } from '@seed/front/shared/types';

export class SignInPO {
  readonly selector = 'seed-shared-auth-container-sign-in';

  readonly texts = {
    messages: {
      welcome: 'Welcome!',
      welcomeBack: 'Welcome back!',
    },
    buttons: {
      anonymously: 'Try app anonymously',
    },
  };

  get(): Cypress.Chainable {
    return cy.get(this.selector);
  }

  getSignInButton(method: AuthProvider): Cypress.Chainable {
    return cy.get(this.selector).get(`button[data-e2e=${method}]`);
  }

  signIn(method: AuthProvider): void {
    this.getSignInButton(method).click();
  }

  signOut(): void {
    cy.get(this.selector).get(`button[data-e2e=signOut]`).click();
  }
}
