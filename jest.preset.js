const nxPreset = require('@nrwl/jest/preset');
module.exports = {
  ...nxPreset,
  testMatch: ['**/+(*.)+(spec|test).+(ts|js)?(x)'],
  transform: {
    '^.+\\.(ts|js|html)$': 'ts-jest',
  },
  resolver: '@nrwl/jest/plugins/resolver',
  moduleFileExtensions: ['ts', 'js', 'html', 'json'],
  coverageReporters: ['html'],
  silent: true, // prevents console.log/error/warn to appear during tests run. To debug run `$ yarn test xxxx --silent=false`
  testTimeout: 10000,
  moduleNameMapper: {
    '^lodash-es$': 'lodash',
    '^validator/es/lib/isEmail$': 'validator/lib/isEmail',
    '^validator/es/lib/isMobilePhone$': 'validator/lib/isMobilePhone',
  },
};
