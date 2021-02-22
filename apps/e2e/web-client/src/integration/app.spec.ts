describe('web-client', () => {
  beforeEach(() => cy.visit('/'));

  it('should display welcome message', () => {
    cy.login('my-email@something.com', 'myPassword');
    cy.get('router-outlet').should('be.empty');
  });
});
