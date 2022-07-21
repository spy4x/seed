import { getJestProjects } from '@nrwl/jest';

export default {
  projects: [...getJestProjects(), '<rootDir>/libs/front/shared/styles', '<rootDir>/libs/e2e/shared/auth'],
};
