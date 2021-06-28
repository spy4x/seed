export enum SignInMethods {
  anonymous = 'anonymous',
}

export class SignInComponentPO {
  readonly selector = 'seed-auth-sign-in';

  readonly texts = {
    messages: {
      welcome: 'Welcome! Please use one of sign in methods below.',
      welcomeBack: 'Welcome back!',
    },
    buttons: {
      anonymously: 'Sign in anonymously',
    },
  };

  get(): Cypress.Chainable {
    return cy.get(this.selector);
  }

  getButton(method: SignInMethods): Cypress.Chainable {
    return cy.get(this.selector).get(`button[data-cy=${method}]`);
  }

  signIn(method: SignInMethods): void {
    this.getButton(method).click();
  }
}
