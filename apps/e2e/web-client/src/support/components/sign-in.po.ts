export enum SignInMethods {
  anonymous = 'anonymous',
}

export class SignInComponentPO {
  readonly selector = 'seed-shared-auth-container-sign-in';

  readonly texts = {
    messages: {
      welcome: 'Welcome!',
      welcomeBack: 'Welcome back!',
    },
    buttons: {
      anonymously: 'Sign in anonymously',
    },
  };

  get(): Cypress.Chainable {
    return cy.get(this.selector);
  }

  getSignInButton(method: SignInMethods): Cypress.Chainable {
    return cy.get(this.selector).get(`button[data-e2e=${method}]`);
  }

  signIn(method: SignInMethods): void {
    this.getSignInButton(method).click();
  }

  signOut(): void {
    cy.get(this.selector).get(`button[data-e2e=signOut]`).click();
  }
}
