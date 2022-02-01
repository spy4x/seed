const { getJestProjects } = require('@nrwl/jest');

module.exports = {
  projects: [...getJestProjects(), '<rootDir>/libs/front/shared/styles', '<rootDir>/libs/e2e/shared/auth'],
};
