import { getGreeting } from '../support/app.po';

describe('admin', () => {
  beforeEach(() => cy.visit('/'));

  it('should display welcome message', () => {
    getGreeting().contains('Welcome to admin!');
  });
});
