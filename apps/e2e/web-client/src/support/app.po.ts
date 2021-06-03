import Chainable = Cypress.Chainable;

export const getGreeting = (): Chainable => cy.get('h1');
